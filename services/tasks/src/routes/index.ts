import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, desc, asc, sql, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

// Best-effort event publish. Skipped silently if the bus isn't initialised
// (e.g. unit tests) or NATS is unreachable — never breaks the HTTP request.
function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
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

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const tasksRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "tasks" }));

  // ───────────── tasks CRUD ─────────────
  typed.get("/tasks", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        projectId: Type.Optional(Type.String({ format: "uuid" })),
        status: Type.Optional(Type.String()),
        profileId: Type.Optional(Type.String({ format: "uuid" })),
      }),
      response: {
        200: Type.Object({
          data: Type.Array(Type.Any()),
          pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
        }),
      },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const conds = [eq(schema.tasks.isArchived, false)];
    if (q.projectId) conds.push(eq(schema.tasks.projectId, q.projectId));
    if (q.status) conds.push(eq(schema.tasks.status, q.status));
    if (q.profileId) conds.push(sql`${schema.tasks.profileIds} @> ARRAY[${q.profileId}]::uuid[]`);
    const where = and(...conds);
    const rows = await db.select().from(schema.tasks).where(where)
      .orderBy(desc(schema.tasks.priority), asc(schema.tasks.sortOrder), asc(schema.tasks.createdAt))
      .limit(limit).offset(offset);
    const total = await totalOf(schema.tasks, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/tasks", {
    schema: { body: Type.Object({
      title: Type.String(),
      priority: Type.Optional(Type.Integer()),
      description: Type.Optional(Type.String()),
      assignee: Type.Optional(Type.String()),
      deadline: Type.Optional(Type.String({ format: "date-time" })),
      projectId: Type.Optional(Type.String({ format: "uuid" })),
      profileIds: Type.Optional(Type.Array(Type.String())),
      recurrence: Type.Optional(Type.String()),
    }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.tasks).values(req.body as any).returning();
    emit("pmos.tasks.tasks.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/tasks/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "tasks not found");
    return reply.send(row);
  });

  typed.patch("/tasks/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
      title: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      priority: Type.Optional(Type.Integer()),
      description: Type.Optional(Type.String()),
      assignee: Type.Optional(Type.String()),
      deadline: Type.Optional(Type.String({ format: "date-time" })),
      projectId: Type.Optional(Type.String({ format: "uuid" })),
      profileIds: Type.Optional(Type.Array(Type.String())),
      recurrence: Type.Optional(Type.String()),
      isArchived: Type.Optional(Type.Boolean()),
    }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const [prev] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!prev) return fail(404, "NOT_FOUND", "tasks not found");
    const body = req.body as any;
    // Streak semantics: completing a task bumps the streak; leaving done resets it.
    const patch: any = { ...body, updatedAt: new Date() };
    if (body.status === "done" && prev.status !== "done") {
      patch.currentStreak = (prev.currentStreak ?? 0) + 1;
      patch.bestStreak = Math.max(prev.bestStreak ?? 0, patch.currentStreak);
      patch.completedAt = new Date();
    } else if (body.status && body.status !== "done" && prev.status === "done") {
      patch.currentStreak = 0;
      patch.completedAt = null;
    }
    const [row] = await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id)).returning();
    emit("pmos.tasks.tasks.updated", row);
    return reply.send(row);
  });

  // Soft delete per notes pattern (isArchived=true; contract lists isArchived as archive flag).
  typed.delete("/tasks/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.update(schema.tasks).set({ isArchived: true, updatedAt: new Date() })
      .where(eq(schema.tasks.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "tasks not found");
    emit("pmos.tasks.tasks.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── priorities ─────────────
  typed.get("/priorities", {
    schema: { response: { 200: Type.Object({ data: Type.Array(Type.Any()) }) } }
  }, async (_req, reply) => {
    const rows = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.isArchived, false))
      .orderBy(desc(schema.tasks.priority), asc(schema.tasks.sortOrder));
    return reply.send({ data: rows });
  });

  typed.put("/priorities/order", {
    schema: {
      body: Type.Object({ orderedIds: Type.Array(Type.String({ format: "uuid" })) }),
      response: { 200: Type.Object({ ok: Type.Boolean() }) },
    },
  }, async (req, reply) => {
    const orderedIds = (req.body as any).orderedIds as string[];
    // Persist manual ordering: lower index => lower sortOrder (higher in list).
    for (let i = 0; i < orderedIds.length; i++) {
      const tid = orderedIds[i] as string;
      await db.update(schema.tasks).set({ sortOrder: i }).where(eq(schema.tasks.id, tid));
    }
    return reply.send({ ok: true });
  });

};
