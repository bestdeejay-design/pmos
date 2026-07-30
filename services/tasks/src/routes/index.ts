import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";

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

export const tasksRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "tasks" }));


  // ───────────── tasks CRUD ─────────────
  typed.get("/tasks", {
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
    const rows = await db.select().from(schema.tasks).limit(limit).offset(offset);
    const total = await totalOf(schema.tasks);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/tasks", {
    schema: { body: Type.Object({
    title: Type.String(),
    status: Type.Optional(Type.String()),
    priority: Type.Optional(Type.Integer()),
    description: Type.Optional(Type.String()),
    assignee: Type.Optional(Type.String()),
    deadline: Type.Optional(Type.String()),
    projectId: Type.Optional(Type.String({ format: "uuid" })),
    profileIds: Type.Optional(Type.Array(Type.String())),
    recurrence: Type.Optional(Type.String()),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.tasks).values(req.body as any).returning();
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
    deadline: Type.Optional(Type.String()),
    projectId: Type.Optional(Type.String({ format: "uuid" })),
    profileIds: Type.Optional(Type.Array(Type.String())),
    recurrence: Type.Optional(Type.String()),
    isArchived: Type.Optional(Type.Boolean()),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.tasks).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.tasks.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "tasks not found");
    return reply.send(row);
  });

  typed.delete("/tasks/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.tasks).where(eq(schema.tasks.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "tasks not found");
    return reply.code(204).send();
  });


  typed.get("/priorities", async (_req, reply) => {
    const rows = await db.select().from(schema.tasks).orderBy(schema.tasks.priority).limit(100);
    return reply.send({ data: rows });
  });

  typed.put("/priorities/order", {
    schema: { body: Type.Object({ orderedIds: Type.Array(Type.String({ format: "uuid" })) }, { additionalProperties: true }) },
  }, async (_req, reply) => {
    return reply.send({ ok: true });
  });

};
