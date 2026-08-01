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
const tableCols = new Set<string>(["id", "name", "description", "goal", "status", "profileIds", "createdAt", "updatedAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "projects" }));

  // ───────────── projects CRUD (reference pattern) ─────────────
  typed.get("/projects", {
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
    const rows = await db.select().from(schema.projects).where(where)
      .orderBy(asc(schema.projects.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.projects, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/projects", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.projects).values(req.body as any).returning();
    emit("pmos.projects.projects.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    return reply.send(row);
  });

  typed.patch("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.projects).set(patch)
      .where(eq(schema.projects.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    emit("pmos.projects.projects.updated", row);
    return reply.send(row);
  });

  typed.delete("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    emit("pmos.projects.projects.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── project dashboard (event-driven index) ─────────────
  typed.get("/projects/:id/items", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: {
        200: Type.Object({
          notes: Type.Array(Type.Any()),
          tasks: Type.Array(Type.Any()),
          meetings: Type.Array(Type.Any()),
          files: Type.Array(Type.Any()),
        }),
        404: Type.Any(),
      },
    },
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const proj = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    if (!proj[0]) return fail(404, "NOT_FOUND", "projects not found");
    const rows = await db.select().from(schema.projectItems).where(eq(schema.projectItems.projectId, id));
    const groupKey: Record<string, string> = { note: "notes", task: "tasks", meeting: "meetings", file: "files" };
    const grouped: Record<string, unknown[]> = { notes: [], tasks: [], meetings: [], files: [] };
    for (const r of rows) {
      const key = groupKey[r.entityType];
      if (key && grouped[key]) grouped[key]!.push(r);
    }
    return reply.send({ notes: grouped.notes, tasks: grouped.tasks, meetings: grouped.meetings, files: grouped.files });
  });

  typed.get("/projects/:id/gantt", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: { 200: Type.Object({ tasks: Type.Array(Type.Any()) }), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const proj = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    if (!proj[0]) return fail(404, "NOT_FOUND", "projects not found");
    const rows = await db.select().from(schema.projectItems)
      .where(and(eq(schema.projectItems.projectId, id), eq(schema.projectItems.entityType, "task")));
    const tasks = rows.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      const dependencies = Array.isArray(payload.dependencies) ? payload.dependencies : [];
      return {
        id: r.entityId,
        title: r.title ?? "",
        start: r.startDate ?? null,
        end: (payload.endDate ?? payload.deadline ?? null) as string | null,
        dependencies,
      };
    });
    return reply.send({ tasks });
  });
};
