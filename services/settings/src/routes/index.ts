import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

// columns present on the backing table (used to guard optional order-by)
const tableCols = new Set<string>(["key", "value", "updatedAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "settings" }));

  // ───────────── settings CRUD (reference pattern) ─────────────
  typed.get("/settings", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),

      }),
      response: { 200: Type.Object({
        data: Type.Array(Type.Any()),
        pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
      }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const conds: any[] = [];


    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.settings).where(where)
      .orderBy(asc(schema.settings.updatedAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.settings, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  // KV upsert per contract (operationId upsertSetting): same key updates in place.
  typed.post("/settings", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any(), 201: Type.Any() } },
  }, async (req, reply) => {
    const body = req.body as any;
    const now = new Date().toISOString();
    const [prev] = await db.select().from(schema.settings).where(eq(schema.settings.key, body.key)).limit(1);
    const [row] = await db.insert(schema.settings).values({ ...body, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: body.value, updatedAt: now },
      })
      .returning();
    emit(prev ? "pmos.settings.settings.updated" : "pmos.settings.settings.created", row);
    return reply.code(prev ? 200 : 201).send(row);
  });

  typed.get("/settings/:key", {
    schema: { params: Type.Object({ key: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "settings not found");
    return reply.send(row);
  });

  typed.patch("/settings/:key", {
    schema: { params: Type.Object({ key: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.settings).set(patch)
      .where(eq(schema.settings.key, (req.params as any).key)).returning();
    if (!row) return fail(404, "NOT_FOUND", "settings not found");
    emit("pmos.settings.settings.updated", row);
    return reply.send(row);
  });

  typed.delete("/settings/:key", {
    schema: { params: Type.Object({ key: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).returning();
    if (!row) return fail(404, "NOT_FOUND", "settings not found");
    emit("pmos.settings.settings.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── non-CRUD endpoints ─────────────
  // Lists Ollama models from the local Ollama instance. Graceful degradation:
  // if Ollama is unreachable we return an empty list with degraded:true (no 500).
  typed.get("/settings/ollama-models", {
    schema: {
      response: { 200: Type.Object({ models: Type.Array(Type.String()), degraded: Type.Boolean() }) },
    },
  }, async (_req, reply) => {
    const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return reply.send({ models: [], degraded: true });
      const data = await res.json() as any;
      const models = Array.isArray(data?.models)
        ? data.models.map((m: any) => m.name).filter((n: unknown): n is string => typeof n === "string")
        : [];
      return reply.send({ models, degraded: false });
    } catch {
      return reply.send({ models: [], degraded: true });
    }
  });
};
