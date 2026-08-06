import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, desc, sql, gte, lte, isNotNull } from "drizzle-orm";
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
const tableCols = new Set<string>(["id", "taskId", "description", "startedAt", "endedAt", "durationSec", "profileIds", "createdAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

// Local-timezone day/week window helpers. DB stores timestamptz as ISO (UTC),
// so comparing against these UTC instants yields local calendar boundaries.
function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}
function startOfTomorrowIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
}
function startOfWeekIso(): string {
  const now = new Date();
  const diffToMonday = (now.getDay() + 6) % 7; // Sunday=6, Monday=0
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday).toISOString();
}
function startOfNextWeekIso(): string {
  const now = new Date();
  const diffToMonday = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday + 7).toISOString();
}

export const time_trackingRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "time-tracking" }));

  // ───────────── timesheet CRUD (reference pattern) ─────────────
  typed.get("/timesheet", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        taskId: Type.Optional(Type.String()),
        from: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
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
    if (q.taskId) conds.push(eq(schema.timesheet.taskId, q.taskId));
    if (q.from) conds.push(gte(schema.timesheet.startedAt, q.from));
    if (q.to) conds.push(lte(schema.timesheet.startedAt, q.to));

    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.timesheet).where(where)
      .orderBy(asc(schema.timesheet.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.timesheet, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/timesheet", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.timesheet).values(req.body as any).returning();
    emit("pmos.time-tracking.timesheet.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/timesheet/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.timesheet).where(eq(schema.timesheet.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "timesheet not found");
    return reply.send(row);
  });

  typed.patch("/timesheet/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.timesheet).set(patch)
      .where(eq(schema.timesheet.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "timesheet not found");
    emit("pmos.time-tracking.timesheet.updated", row);
    return reply.send(row);
  });

  typed.delete("/timesheet/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.timesheet).where(eq(schema.timesheet.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "timesheet not found");
    emit("pmos.time-tracking.timesheet.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── timesheet stats ─────────────
  // Aggregates today/week totals (durationSec sums) plus a period-wide total,
  // per-day sums and grouped per-task / per-project totals. task→project lookup
  // uses the task_projects cache populated by NATS subscribers (events/subscribe.ts).
  typed.get("/timesheet/stats", {
    schema: {
      querystring: Type.Object({
        from: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Object({
        total: Type.Integer(),
        todayTotal: Type.Integer(),
        weekTotal: Type.Integer(),
        perDay: Type.Array(Type.Object({
          date: Type.String(),
          total: Type.Integer(),
        })),
        byTask: Type.Array(Type.Object({
          taskId: Type.String(),
          taskTitle: Type.Union([Type.String(), Type.Null()]),
          total: Type.Integer(),
        })),
        byProject: Type.Array(Type.Object({
          projectId: Type.String(),
          projectName: Type.Union([Type.String(), Type.Null()]),
          total: Type.Integer(),
        })),
      }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const baseConds: any[] = [];
    if (q.from) baseConds.push(gte(schema.timesheet.startedAt, q.from));
    if (q.to) baseConds.push(lte(schema.timesheet.startedAt, q.to));
    const sumSql = sql<number>`coalesce(sum(${schema.timesheet.durationSec}), 0)::int`;

    const todayTotal = (await db.select({ total: sumSql }).from(schema.timesheet)
      .where(and(gte(schema.timesheet.startedAt, startOfTodayIso()), lte(schema.timesheet.startedAt, startOfTomorrowIso()), ...baseConds))
      .limit(1))[0]?.total ?? 0;

    const weekTotal = (await db.select({ total: sumSql }).from(schema.timesheet)
      .where(and(gte(schema.timesheet.startedAt, startOfWeekIso()), lte(schema.timesheet.startedAt, startOfNextWeekIso()), ...baseConds))
      .limit(1))[0]?.total ?? 0;

    const total = (await db.select({ total: sumSql }).from(schema.timesheet)
      .where(and(...baseConds))
      .limit(1))[0]?.total ?? 0;

    const perDay = await db.select({
      date: sql<string>`to_char(date_trunc('day', ${schema.timesheet.startedAt}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${schema.timesheet.durationSec}), 0)::int`,
    }).from(schema.timesheet)
      .where(and(...baseConds))
      .groupBy(sql`date_trunc('day', ${schema.timesheet.startedAt})`)
      .orderBy(asc(sql`date_trunc('day', ${schema.timesheet.startedAt})`));

    const byTaskRows = await db.select({
      taskId: schema.timesheet.taskId,
      taskTitle: schema.taskProjects.taskTitle,
      total: sumSql,
    }).from(schema.timesheet)
      .leftJoin(schema.taskProjects, eq(schema.taskProjects.taskId, schema.timesheet.taskId))
      .where(and(isNotNull(schema.timesheet.taskId), ...baseConds))
      .groupBy(schema.timesheet.taskId, schema.taskProjects.taskTitle);

    const byProjectRows = await db.select({
      projectId: schema.taskProjects.projectId,
      projectName: schema.taskProjects.projectName,
      total: sumSql,
    }).from(schema.timesheet)
      .innerJoin(schema.taskProjects, eq(schema.taskProjects.taskId, schema.timesheet.taskId))
      .where(and(isNotNull(schema.taskProjects.projectId), ...baseConds))
      .groupBy(schema.taskProjects.projectId, schema.taskProjects.projectName);

    return reply.send({
      total,
      todayTotal,
      weekTotal,
      perDay,
      byTask: byTaskRows.map((r) => ({ taskId: r.taskId as string, taskTitle: r.taskTitle, total: r.total })),
      byProject: byProjectRows.map((r) => ({ projectId: r.projectId as string, projectName: r.projectName, total: r.total })),
    });
  });

  // ───────────── pomodoro sessions ─────────────
  typed.get("/pomodoro", {
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
    const rows = await db.select().from(schema.pomodoroSessions)
      .orderBy(desc(schema.pomodoroSessions.startedAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.pomodoroSessions);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  // Start a session: modes pomodoro|flowtime|countdown.
  typed.post("/pomodoro", {
    schema: {
      body: Type.Object({
        mode: Type.String(),
        plannedMin: Type.Optional(Type.Integer()),
        taskId: Type.Optional(Type.String()),
      }, { additionalProperties: true }),
      response: { 201: Type.Any() },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    if (!["pomodoro", "flowtime", "countdown"].includes(body.mode)) {
      return fail(400, "VALIDATION_ERROR", "mode must be one of: pomodoro, flowtime, countdown");
    }
    const [row] = await db.insert(schema.pomodoroSessions).values({
      mode: body.mode,
      startedAt: new Date().toISOString(),
      plannedMin: body.plannedMin ?? null,
      taskId: body.taskId ?? null,
      completed: false,
    }).returning();
    emit("pmos.time-tracking.pomodoro.created", row);
    return reply.code(201).send(row);
  });

  // Complete/update a session: sets endedAt, marks completed, computes completedMin
  // (elapsed minutes between startedAt and endedAt).
  typed.patch("/pomodoro/:id", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({}, { additionalProperties: true }),
      response: { 200: Type.Any(), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const body = req.body as any;
    const [prev] = await db.select().from(schema.pomodoroSessions).where(eq(schema.pomodoroSessions.id, id)).limit(1);
    if (!prev) return fail(404, "NOT_FOUND", "pomodoro not found");

    const patch: any = {};
    if (body.endedAt !== undefined) patch.endedAt = body.endedAt;
    if (body.completed === true) {
      patch.completed = true;
      if (!patch.endedAt) patch.endedAt = new Date().toISOString();
    } else if (body.completed === false) {
      patch.completed = false;
    }
    // Plain field updates (no completion intent) leave endedAt/completed untouched.
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.plannedMin !== undefined) patch.plannedMin = body.plannedMin;
    if (body.taskId !== undefined) patch.taskId = body.taskId;

    if (patch.endedAt) {
      const ms = new Date(patch.endedAt).getTime() - new Date(prev.startedAt).getTime();
      if (ms >= 0) patch.completedMin = Math.round(ms / 60000);
      patch.completed = true; // ended session is a completed session
    }

    const [row] = await db.update(schema.pomodoroSessions).set(patch)
      .where(eq(schema.pomodoroSessions.id, id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "pomodoro not found");
    emit("pmos.time-tracking.pomodoro.updated", row);
    return reply.send(row);
  });
};
