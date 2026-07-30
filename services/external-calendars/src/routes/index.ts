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

export const externalCalendarsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "external-calendars" }));


  // ───────────── externalCalendars CRUD ─────────────
  typed.get("/calendars", {
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
    const rows = await db.select().from(schema.externalCalendars).limit(limit).offset(offset);
    const total = await totalOf(schema.externalCalendars);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/calendars", {
    schema: { body: Type.Object({
    displayName: Type.String(),
    provider: Type.String(),
    syncEnabled: Type.Optional(Type.Boolean()),
    authData: Type.Optional(Type.Any()),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.externalCalendars).values(req.body as any).returning();
    return reply.code(201).send(row);
  });

  typed.get("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "externalCalendars not found");
    return reply.send(row);
  });

  typed.patch("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
    displayName: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    syncEnabled: Type.Optional(Type.Boolean()),
    authData: Type.Optional(Type.Any()),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.externalCalendars).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.externalCalendars.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "externalCalendars not found");
    return reply.send(row);
  });

  typed.delete("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.externalCalendars).where(eq(schema.externalCalendars.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "externalCalendars not found");
    return reply.code(204).send();
  });


  typed.post("/calendars/sync/:id", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (_req, reply) => reply.send({ syncedEvents: 0 }));

  typed.get("/calendars/:id/events", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const rows = await db.select().from(schema.externalEvents).where(eq(schema.externalEvents.calendarId, (req.params as any).id)).limit(200);
    return reply.send({ data: rows });
  });

  typed.patch("/calendars/events/:id/link", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }), body: Type.Object({ meetingId: Type.Optional(Type.String({ format: "uuid" })) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ ok: true }));

};
