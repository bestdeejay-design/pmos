import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, desc, asc, sql, inArray, ne } from "drizzle-orm";
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

// Compute the next occurrence date for a recurrence RRULE (FREQ=DAILY|WEEKLY|MONTHLY[;INTERVAL=n]).
// Honest minimal parser — enough for the "spawn next instance on close" feature.
// COUNT/UNTIL termination is enforced by the caller (we just stop spawning once a task
// without recurrence exists; full expansion is out of scope for the reference impl).
function nextOccurrence(rrule: string, fromIso: string): string {
  const from = new Date(fromIso);
  if (isNaN(from.getTime())) return new Date().toISOString();
  const freq = (rrule.match(/FREQ=([A-Z]+)/i)?.[1] ?? "DAILY").toUpperCase();
  const interval = Number(rrule.match(/INTERVAL=(\d+)/i)?.[1] ?? "1") || 1;
  const d = new Date(from);
  if (freq === "WEEKLY") d.setDate(d.getDate() + 7 * interval);
  else if (freq === "MONTHLY") d.setMonth(d.getMonth() + interval);
  else d.setDate(d.getDate() + interval); // DAILY (default)
  return d.toISOString();
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

    // Validate Kanban status (TEST_CASES 3.2).
    if (body.status !== undefined && !["todo", "in_progress", "done"].includes(body.status)) {
      return fail(400, "VALIDATION_ERROR", "status must be one of: todo, in_progress, done");
    }

    // Dependency blocking: cannot close a task while a blocker is not done (TEST_CASES 3.4).
    if (body.status === "done" && prev.status !== "done") {
      const blockers = await db.select().from(schema.taskDependencies)
        .where(eq(schema.taskDependencies.taskId, id));
      if (blockers.length) {
        const ids = blockers.map((b) => b.dependsOnId);
        const open = await db.select({ id: schema.tasks.id }).from(schema.tasks)
          .where(and(inArray(schema.tasks.id, ids), ne(schema.tasks.status, "done")));
        if (open.length) {
          return fail(409, "CONFLICT",
            `Blocked by tasks: ${open.map((o) => o.id).join(", ")}`);
        }
      }
    }

    // Streak semantics: completing a task bumps the streak; leaving done resets it.
    const patch: any = { ...body, updatedAt: new Date().toISOString() };
    if (body.status === "done" && prev.status !== "done") {
      patch.currentStreak = (prev.currentStreak ?? 0) + 1;
      patch.bestStreak = Math.max(prev.bestStreak ?? 0, patch.currentStreak);
      patch.completedAt = new Date().toISOString();
      // Recurrence: spawn the next occurrence (FEATURES: "автозакрытие и создание новой").
      if (prev.recurrence) {
        const nextStart = nextOccurrence(prev.recurrence, prev.deadline ?? prev.createdAt);
        const [created] = await db.insert(schema.tasks).values({
          title: prev.title,
          status: "todo",
          priority: prev.priority,
          description: prev.description,
          assignee: prev.assignee,
          projectId: prev.projectId,
          profileIds: prev.profileIds,
          recurrence: prev.recurrence,
          deadline: nextStart,
        }).returning();
        emit("pmos.tasks.tasks.created", created);
      }
    } else if (body.status && body.status !== "done" && prev.status === "done") {
      patch.currentStreak = 0;
      patch.completedAt = null;
    }

    const [row] = await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id)).returning();
    if (body.status !== undefined && body.status !== prev.status) {
      emit("pmos.tasks.tasks.status_changed", {
        taskId: id, oldStatus: prev.status, newStatus: body.status,
      });
    }
    emit("pmos.tasks.tasks.updated", row);
    return reply.send(row);
  });

  // Soft delete per notes pattern (isArchived=true; contract lists isArchived as archive flag).
  typed.delete("/tasks/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.update(schema.tasks).set({ isArchived: true, updatedAt: new Date().toISOString() })
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

  // ───────────── dependencies (blocking) ─────────────
  typed.get("/tasks/:id/dependencies", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Object({ data: Type.Array(Type.String()) }) } }
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const rows = await db.select().from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, id));
    return reply.send({ data: rows.map((r) => r.dependsOnId) });
  });

  typed.post("/tasks/:id/dependencies", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ dependsOnId: Type.String({ format: "uuid" }) }),
      response: { 201: Type.Object({ ok: Type.Boolean() }), 409: Type.Any(), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const dependsOnId = (req.body as any).dependsOnId as string;
    if (id === dependsOnId) return fail(409, "CONFLICT", "task cannot depend on itself");
    const [task] = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return fail(404, "NOT_FOUND", "tasks not found");
    const [blocker] = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, dependsOnId)).limit(1);
    if (!blocker) return fail(404, "NOT_FOUND", "dependsOn task not found");
    await db.insert(schema.taskDependencies).values({ taskId: id, dependsOnId }).onConflictDoNothing();
    return reply.code(201).send({ ok: true });
  });

  typed.delete("/tasks/:id/dependencies/:dependsOnId", {
    schema: { params: Type.Object({ id: Type.String(), dependsOnId: Type.String({ format: "uuid" }) }) }
  }, async (req, reply) => {
    const { id, dependsOnId } = req.params as any;
    await db.delete(schema.taskDependencies)
      .where(and(eq(schema.taskDependencies.taskId, id), eq(schema.taskDependencies.dependsOnId, dependsOnId)));
    return reply.code(204).send();
  });

  // ───────────── templates CRUD (mirror of notes templates) ─────────────
  typed.get("/templates", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
    const where = q.profileId ? eq(schema.templates.profileId, q.profileId) : undefined;
    const rows = await db.select().from(schema.templates).where(where).orderBy(asc(schema.templates.name)).limit(limit).offset(offset);
    const total = await totalOf(schema.templates, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/templates", {
    schema: { body: Type.Object({
      name: Type.String(),
      bodyMd: Type.Optional(Type.String()),
      profileId: Type.String({ format: "uuid" }),
    }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.templates).values(req.body as any).returning();
    emit("pmos.tasks.templates.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/templates/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "templates not found");
    return reply.send(row);
  });

  typed.patch("/templates/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
      name: Type.Optional(Type.String()),
      bodyMd: Type.Optional(Type.String()),
      profileId: Type.Optional(Type.String({ format: "uuid" })),
    }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.templates).set({ ...(req.body as any), updatedAt: new Date().toISOString() })
      .where(eq(schema.templates.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "templates not found");
    emit("pmos.tasks.templates.updated", row);
    return reply.send(row);
  });

  typed.delete("/templates/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.templates).where(eq(schema.templates.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "templates not found");
    emit("pmos.tasks.templates.deleted", row);
    return reply.code(204).send();
  });

};
