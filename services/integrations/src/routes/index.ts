import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, asc, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { randomBytes, createHash } from "node:crypto";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = status; e.code = code; throw e;
}

async function totalOf(t: AnyPgTable, where?: SQL): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const integrationsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "integrations" }));

  // ───────────── webhooks CRUD ─────────────
  typed.get("/webhooks", {
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
    const q = req.query as { offset?: number; limit?: number };
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const rows = await db.select().from(schema.webhooks).where(undefined)
      .orderBy(asc(schema.webhooks.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.webhooks, undefined);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/webhooks", {
    schema: {
      body: Type.Object({
        url: Type.String(),
        events: Type.Array(Type.String()),
        secret: Type.Optional(Type.String()),
      }, { additionalProperties: true }),
      response: { 201: Type.Any() },
    },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.webhooks)
      .values(req.body as { url: string; events: string[]; secret?: string }).returning();
    emit("pmos.integrations.webhooks.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/webhooks/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [row] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "webhooks not found");
    return reply.send(row);
  });

  typed.patch("/webhooks/:id", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({
        url: Type.Optional(Type.String()),
        events: Type.Optional(Type.Array(Type.String())),
        active: Type.Optional(Type.Boolean()),
        secret: Type.Optional(Type.String()),
      }, { additionalProperties: true }),
      response: { 200: Type.Any() },
    },
  }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [row] = await db.update(schema.webhooks)
      .set(req.body as { url?: string; events?: string[]; active?: boolean; secret?: string })
      .where(eq(schema.webhooks.id, id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "webhooks not found");
    emit("pmos.integrations.webhooks.updated", row);
    return reply.send(row);
  });

  typed.delete("/webhooks/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [row] = await db.delete(schema.webhooks).where(eq(schema.webhooks.id, id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "webhooks not found");
    emit("pmos.integrations.webhooks.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── webhook delivery history ─────────────
  typed.get("/webhooks/:id/deliveries", {
    schema: {
      params: Type.Object({ id: Type.String() }),
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
    const q = req.query as { offset?: number; limit?: number };
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const id = (req.params as { id: string }).id;
    const where = eq(schema.webhookDeliveries.webhookId, id);
    const rows = await db.select().from(schema.webhookDeliveries).where(where)
      .orderBy(desc(schema.webhookDeliveries.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.webhookDeliveries, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  // ───────────── API keys ─────────────
  // List: never expose key_hash or the raw key — only id, name, keyPrefix, active, createdAt.
  typed.get("/api-keys", {
    schema: {
      response: { 200: Type.Object({ data: Type.Array(Type.Any()) }) },
    },
  }, async (_req, reply) => {
    const rows = await db.select().from(schema.apiKeys).orderBy(asc(schema.apiKeys.createdAt));
    const data = rows.map((r) => ({
      id: r.id, name: r.name, keyPrefix: r.keyPrefix, active: r.active, createdAt: r.createdAt,
    }));
    return reply.send({ data });
  });

  typed.post("/api-keys", {
    schema: {
      body: Type.Object({ name: Type.String() }, { additionalProperties: true }),
      response: { 201: Type.Any() },
    },
  }, async (req, reply) => {
    const name = (req.body as { name: string }).name;
    // Generate raw key once: pk_<32 hex bytes>. Only SHA-256 hash + prefix are stored.
    const rawKey = "pk_" + randomBytes(32).toString("hex");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 8);
    const [row] = await db.insert(schema.apiKeys)
      .values({ name, keyHash, keyPrefix, active: true }).returning();
    if (!row) return fail(500, "INTERNAL_ERROR", "failed to create api key");
    emit("pmos.integrations.api-keys.created", { id: row.id, name: row.name });
    // The raw `key` is returned exactly once, right here.
    return reply.code(201).send({
      id: row.id, name: row.name, key: rawKey, keyPrefix: row.keyPrefix,
      active: row.active, createdAt: row.createdAt,
    });
  });

  typed.delete("/api-keys/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [row] = await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "api key not found");
    return reply.code(204).send();
  });
};
