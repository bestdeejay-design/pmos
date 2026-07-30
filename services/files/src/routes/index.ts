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

export const filesRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "files" }));


  // ───────────── fileMeta CRUD ─────────────
  typed.get("/files", {
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
    const rows = await db.select().from(schema.fileMeta).limit(limit).offset(offset);
    const total = await totalOf(schema.fileMeta);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/files", {
    schema: { body: Type.Object({
    filename: Type.String(),
    mimeType: Type.String(),
    size: Type.Optional(Type.Integer()),
    ownerType: Type.Optional(Type.String()),
    ownerId: Type.Optional(Type.String({ format: "uuid" })),
    storagePath: Type.String(),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.fileMeta).values(req.body as any).returning();
    return reply.code(201).send(row);
  });

  typed.get("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "fileMeta not found");
    return reply.send(row);
  });

  typed.patch("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
    filename: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
    size: Type.Optional(Type.Integer()),
    ownerType: Type.Optional(Type.String()),
    ownerId: Type.Optional(Type.String({ format: "uuid" })),
    storagePath: Type.Optional(Type.String()),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.fileMeta).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.fileMeta.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "fileMeta not found");
    return reply.send(row);
  });

  typed.delete("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "fileMeta not found");
    return reply.code(204).send();
  });


  typed.get("/:id/download", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "file not found");
    return reply.header("content-type", row.mimeType).send(Buffer.from(""));
  });

};
