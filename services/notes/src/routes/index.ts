import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, sql, inArray } from "drizzle-orm";
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

export const notesRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "notes" }));

  // ───────────── notes CRUD ─────────────
  typed.get("/notes", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        profileId: Type.Optional(Type.String({ format: "uuid" })),
        isArchived: Type.Optional(Type.Boolean()),
        tag: Type.Optional(Type.String()),
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
    const conds = [];
    if (q.profileId) conds.push(sql`${schema.notes.profileIds} @> ARRAY[${q.profileId}]::uuid[]`);
    if (typeof q.isArchived === "boolean") conds.push(eq(schema.notes.isArchived, q.isArchived));
    else conds.push(eq(schema.notes.isArchived, false));
    if (q.tag) conds.push(sql`${schema.notes.tags} @> ARRAY[${q.tag}]::text[]`);
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.notes).where(where).orderBy(asc(schema.notes.sortOrder), asc(schema.notes.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.notes, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/notes", {
    schema: { body: Type.Object({
      title: Type.String(),
      bodyMd: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      profileIds: Type.Optional(Type.Array(Type.String())),
      linkedProjectId: Type.Optional(Type.String({ format: "uuid" })),
      linkedMeetingId: Type.Optional(Type.String({ format: "uuid" })),
      linkedTaskId: Type.Optional(Type.String({ format: "uuid" })),
    }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.notes).values(req.body as any).returning();
    emit("pmos.notes.notes.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/notes/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.notes).where(eq(schema.notes.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "notes not found");
    return reply.send(row);
  });

  typed.patch("/notes/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
      title: Type.Optional(Type.String()),
      bodyMd: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      profileIds: Type.Optional(Type.Array(Type.String())),
      linkedProjectId: Type.Optional(Type.String({ format: "uuid" })),
      linkedMeetingId: Type.Optional(Type.String({ format: "uuid" })),
      linkedTaskId: Type.Optional(Type.String({ format: "uuid" })),
      isArchived: Type.Optional(Type.Boolean()),
    }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.notes).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.notes.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "notes not found");
    emit("pmos.notes.notes.updated", row);
    return reply.send(row);
  });

  // Soft delete per contract (мягкое удаление, isArchived = true).
  typed.delete("/notes/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.update(schema.notes).set({ isArchived: true, updatedAt: new Date() })
      .where(eq(schema.notes.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "notes not found");
    emit("pmos.notes.notes.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── templates CRUD ─────────────
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
    emit("pmos.notes.templates.created", row);
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
    const [row] = await db.update(schema.templates).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.templates.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "templates not found");
    emit("pmos.notes.templates.updated", row);
    return reply.send(row);
  });

  typed.delete("/templates/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.templates).where(eq(schema.templates.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "templates not found");
    emit("pmos.notes.templates.deleted", row);
    return reply.code(204).send();
  });

};
