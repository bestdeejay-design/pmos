import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, desc, gte, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";

function fail(status: number, code: string, message: string): never {
  const e = new Error(message) as Error & { statusCode?: number; code?: string };
  e.statusCode = status;
  e.code = code;
  throw e;
}

/** UTC midnight of today — the "today digest" window start. */
function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** UTC midnight of the Monday of the current week — the "week digest" window start. */
function weekStartIso(): string {
  const d = new Date();
  const sinceMonday = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

interface InboxQuery {
  offset?: number;
  limit?: number;
  status?: string;
}

interface AgentRespondBody {
  messageId: string;
  action: string;
  reply?: string;
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "agent" }));

  // ───────────── Inbox ─────────────
  typed.get<{ Querystring: InboxQuery }>("/agent/inbox", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        status: Type.Optional(Type.String()),
      }),
      response: {
        200: Type.Object({
          data: Type.Array(Type.Any()),
          pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
        }),
      },
    },
  }, async (req, reply) => {
    const offset = req.query.offset ?? 0;
    const limit = req.query.limit ?? 20;
    const status = req.query.status ?? "pending";
    const where = eq(schema.agentMessages.status, status);
    const rows = await db.select().from(schema.agentMessages)
      .where(where).orderBy(desc(schema.agentMessages.createdAt)).limit(limit).offset(offset);
    const [countRow] = await db.select({ total: count() }).from(schema.agentMessages).where(where);
    return reply.send({ data: rows, pagination: { offset, limit, total: countRow?.total ?? 0 } });
  });

  // ───────────── Respond (accept / reject / dismiss / reply) ─────────────
  typed.post<{ Body: AgentRespondBody }>("/agent/respond", {
    schema: {
      body: Type.Object({
        messageId: Type.String({ format: "uuid" }),
        action: Type.String(), // accept | reject | dismiss | reply
        reply: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Object({ ok: Type.Boolean() }) },
    },
  }, async (req, reply) => {
    const { messageId, action, reply: replyText } = req.body;
    const [row] = await db.select().from(schema.agentMessages)
      .where(eq(schema.agentMessages.id, messageId)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "agent message not found");

    let status: "accepted" | "dismissed";
    if (action === "accept" || action === "reply") status = "accepted";
    else if (action === "reject" || action === "dismiss") status = "dismissed";
    else return fail(400, "VALIDATION_ERROR", "action must be one of: accept, reject, dismiss, reply");

    const set: { status: string; actions?: unknown } = { status };
    if (action === "reply") {
      const existing = Array.isArray(row.actions) ? row.actions : [];
      set.actions = [...existing, { id: "reply", label: replyText ?? "" }];
    }
    await db.update(schema.agentMessages).set(set).where(eq(schema.agentMessages.id, messageId));
    return reply.send({ ok: true });
  });

  // ───────────── Dismiss all pending ─────────────
  typed.post("/agent/dismiss-all", {
    schema: { response: { 200: Type.Object({ dismissed: Type.Integer() }) } },
  }, async (_req, reply) => {
    const updated = await db.update(schema.agentMessages)
      .set({ status: "dismissed" }).where(eq(schema.agentMessages.status, "pending"))
      .returning({ id: schema.agentMessages.id });
    return reply.send({ dismissed: updated.length });
  });

  // ───────────── Digests (built from agent's own subscription cache) ─────────────
  typed.get("/today", {
    schema: {
      response: {
        200: Type.Object({
          messages: Type.Array(Type.Any()),
          meetings: Type.Array(Type.Any()),
          tasks: Type.Array(Type.Any()),
        }),
      },
    },
  }, async (_req, reply) => {
    const start = todayStartIso();
    const [messages, meetings, tasks] = await Promise.all([
      db.select().from(schema.agentMessages).where(gte(schema.agentMessages.createdAt, start))
        .orderBy(desc(schema.agentMessages.createdAt)),
      db.select().from(schema.dailyEvents)
        .where(and(eq(schema.dailyEvents.kind, "meeting"), gte(schema.dailyEvents.createdAt, start)))
        .orderBy(desc(schema.dailyEvents.createdAt)),
      db.select().from(schema.dailyEvents)
        .where(and(eq(schema.dailyEvents.kind, "task"), gte(schema.dailyEvents.createdAt, start)))
        .orderBy(desc(schema.dailyEvents.createdAt)),
    ]);
    return reply.send({ messages, meetings, tasks });
  });

  typed.get("/week", {
    schema: {
      response: {
        200: Type.Object({
          messages: Type.Array(Type.Any()),
          meetings: Type.Array(Type.Any()),
          tasks: Type.Array(Type.Any()),
        }),
      },
    },
  }, async (_req, reply) => {
    const start = weekStartIso();
    const [messages, meetings, tasks] = await Promise.all([
      db.select().from(schema.agentMessages).where(gte(schema.agentMessages.createdAt, start))
        .orderBy(desc(schema.agentMessages.createdAt)),
      db.select().from(schema.dailyEvents)
        .where(and(eq(schema.dailyEvents.kind, "meeting"), gte(schema.dailyEvents.createdAt, start)))
        .orderBy(desc(schema.dailyEvents.createdAt)),
      db.select().from(schema.dailyEvents)
        .where(and(eq(schema.dailyEvents.kind, "task"), gte(schema.dailyEvents.createdAt, start)))
        .orderBy(desc(schema.dailyEvents.createdAt)),
    ]);
    return reply.send({ messages, meetings, tasks });
  });
};
