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

  typed.post("/settings", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.settings).values(req.body as any).returning();
    emit("pmos.settings.settings.created", row);
    return reply.code(201).send(row);
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

  // ───────────── non-CRUD endpoints (backlog, see AGENT.md §4) ─────────────
  typed.get("/settings/ollama-models", async (_req, reply) => {
    // TODO(semantics): GET /settings/ollama-models — non-CRUD endpoint, not in the baseline
    // reference pattern. Implement domain logic or remove from contract.
    return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "endpoint planned (see AGENT.md §4 backlog)" });
  });
};
