import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

// Best-effort event publish. Skipped silently if the bus isn't initialised
// (e.g. unit tests) or NATS is unreachable — never breaks the HTTP request.
function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error('[event] publish ' + subject + ' failed:', e));
  } catch {
    /* EventBus not initialised — skip */
  }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status;
  e.code = code;
  throw e;
}

async function totalOf(t: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).limit(1);
  return r[0]?.total ?? 0;
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "agent" }));


  // ───────────── agentMessages CRUD ─────────────
  typed.get("/agent-messages", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: Type.Object({
          data: Type.Array(Type.Any()),
          pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
        }),
      },
    },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.agentMessages).limit(limit).offset(offset);
    const total = await totalOf(schema.agentMessages);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/agent-messages", {
    schema: { body: Type.Object({
    title: Type.String(),
    body: Type.String(),
    type: Type.String(),
    source: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    actions: Type.Optional(Type.Any()),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.agentMessages).values(req.body as any).returning();
    emit('pmos.agent.agent-messages.created', row);
    return reply.code(201).send(row);
  });

  typed.get("/agent-messages/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.agentMessages).where(eq(schema.agentMessages.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "agentMessages not found");
    return reply.send(row);
  });

  typed.patch("/agent-messages/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    actions: Type.Optional(Type.Any()),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.agentMessages).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.agentMessages.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "agentMessages not found");
    emit('pmos.agent.agent-messages.updated', row);
    return reply.send(row);
  });

  typed.delete("/agent-messages/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.agentMessages).where(eq(schema.agentMessages.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "agentMessages not found");
    emit('pmos.agent.agent-messages.deleted', row);
    return reply.code(204).send();
  });


  typed.get("/agent/inbox", {
    schema: { querystring: Type.Object({ status: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }) },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.agentMessages).limit(limit).offset(offset);
    const total = await totalOf(schema.agentMessages);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/agent/respond", {
    schema: { body: Type.Object({ messageId: Type.String({ format: "uuid" }), action: Type.String(), reply: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ ok: true }));

  typed.post("/agent/dismiss-all", async (_req, reply) => reply.send({ dismissed: 0 }));

  typed.get("/today", async (_req, reply) => reply.send({ meetings: [], tasks: [], messages: [] }));
  typed.get("/week", async (_req, reply) => reply.send({ meetings: [], tasks: [] }));

};
