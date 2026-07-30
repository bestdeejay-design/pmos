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

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "projects" }));


  // ───────────── projects CRUD ─────────────
  typed.get("/projects", {
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
    const rows = await db.select().from(schema.projects).limit(limit).offset(offset);
    const total = await totalOf(schema.projects);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/projects", {
    schema: { body: Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    goal: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.projects).values(req.body as any).returning();
    return reply.code(201).send(row);
  });

  typed.get("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    return reply.send(row);
  });

  typed.patch("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    goal: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.projects).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.projects.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    return reply.send(row);
  });

  typed.delete("/projects/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "projects not found");
    return reply.code(204).send();
  });


  typed.get("/:id/items", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "project not found");
    return reply.send({ notes: [], tasks: [], meetings: [], files: [] });
  });

  typed.get("/:id/gantt", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "project not found");
    // Cross-service data (tasks) is fetched via events/gateway at runtime; return empty here.
    return reply.send({ tasks: [] });
  });

};
