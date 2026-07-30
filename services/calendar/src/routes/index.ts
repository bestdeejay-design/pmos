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

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "calendar" }));


  // ───────────── meetings CRUD ─────────────
  typed.get("/meetings", {
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
    const rows = await db.select().from(schema.meetings).limit(limit).offset(offset);
    const total = await totalOf(schema.meetings);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/meetings", {
    schema: { body: Type.Object({
    title: Type.String(),
    startTime: Type.String(),
    endTime: Type.String(),
    allDay: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    recurrence: Type.Optional(Type.String()),
    linkedProjectId: Type.Optional(Type.String({ format: "uuid" })),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.meetings).values(req.body as any).returning();
    return reply.code(201).send(row);
  });

  typed.get("/meetings/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "meetings not found");
    return reply.send(row);
  });

  typed.patch("/meetings/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({
    title: Type.Optional(Type.String()),
    startTime: Type.Optional(Type.String()),
    endTime: Type.Optional(Type.String()),
    allDay: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    recurrence: Type.Optional(Type.String()),
    linkedProjectId: Type.Optional(Type.String({ format: "uuid" })),
    profileIds: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: true }), response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.meetings).set({ ...(req.body as any), updatedAt: new Date() })
      .where(eq(schema.meetings.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "meetings not found");
    return reply.send(row);
  });

  typed.delete("/meetings/:id", {
    schema: { params: Type.Object({ id: Type.String() }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.meetings).where(eq(schema.meetings.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "meetings not found");
    return reply.code(204).send();
  });


  typed.get("/meetings/:id/ics", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "meeting not found");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//pmos//EN",
      "BEGIN:VEVENT", `UID:${row.id}`, `SUMMARY:${row.title}`,
      `DTSTART:${new Date(row.startTime).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTEND:${new Date(row.endTime).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\n");
    return reply.header("content-type", "text/calendar").send(ics);
  });

};
