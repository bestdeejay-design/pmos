import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { toIcs, type IcsMeeting } from "../lib/ics.js";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

// Path params use Fastify's `:id` syntax (NOT OpenAPI `{id}` — Fastify 5 only matches
// colon params at runtime; `{id}` is treated as a literal segment and 404s).
const UUID = Type.String();

const MeetingCreate = Type.Object({
  title: Type.String({ minLength: 1 }),
  startTime: Type.String({ format: "date-time" }),
  endTime: Type.String({ format: "date-time" }),
  allDay: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
  recurrence: Type.Optional(Type.String()),
  linkedProjectId: Type.Optional(UUID),
  profileIds: Type.Optional(Type.Array(UUID)),
}, { additionalProperties: false });

const MeetingUpdate = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1 })),
  startTime: Type.Optional(Type.String({ format: "date-time" })),
  endTime: Type.Optional(Type.String({ format: "date-time" })),
  allDay: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
  recurrence: Type.Optional(Type.String()),
  linkedProjectId: Type.Optional(UUID),
  profileIds: Type.Optional(Type.Array(UUID)),
}, { additionalProperties: false });

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "calendar" }));

  // ───────────── meetings CRUD (reference pattern, hardened) ─────────────

  typed.get("/meetings", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        profileId: Type.Optional(UUID),
        from: Type.Optional(Type.String({ format: "date-time" })),
        to: Type.Optional(Type.String({ format: "date-time" })),
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
    const conds: any[] = [];

    if (q.profileId !== undefined) {
      conds.push(sql`${schema.meetings.profileIds} @> ARRAY[${q.profileId}]::uuid[]`);
    }
    if (q.from !== undefined) conds.push(gte(schema.meetings.startTime, q.from));
    if (q.to !== undefined) conds.push(lte(schema.meetings.startTime, q.to));
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db.select().from(schema.meetings).where(where)
      .orderBy(sql`${schema.meetings.startTime} asc`).limit(limit).offset(offset);
    const total = await totalOf(schema.meetings, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/meetings", {
    schema: { body: MeetingCreate, response: { 201: Type.Any(), 400: Type.Any() } },
  }, async (req, reply) => {
    const b = req.body as any;
    if (new Date(b.endTime) < new Date(b.startTime)) {
      fail(400, "INVALID_TIME_RANGE", "endTime must be greater than or equal to startTime");
    }
    const [row] = await db.insert(schema.meetings).values(b).returning();
    emit("pmos.calendar.meetings.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/meetings/:id", {
    schema: { params: Type.Object({ id: UUID }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.meetings)
      .where(eq(schema.meetings.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "meeting not found");
    return reply.send(row);
  });

  typed.patch("/meetings/:id", {
    schema: { params: Type.Object({ id: UUID }), body: MeetingUpdate, response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const id = (req.params as any).id;
    const b = req.body as any;
    if (b.startTime && b.endTime && new Date(b.endTime) < new Date(b.startTime)) {
      fail(400, "INVALID_TIME_RANGE", "endTime must be greater than or equal to startTime");
    }
    const [existing] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).limit(1);
    if (!existing) return fail(404, "NOT_FOUND", "meeting not found");
    const patch: any = { ...b, updatedAt: new Date().toISOString() };
    const [row] = await db.update(schema.meetings).set(patch).where(eq(schema.meetings.id, id)).returning();
    emit("pmos.calendar.meetings.updated", row);
    return reply.send(row);
  });

  typed.delete("/meetings/:id", {
    schema: { params: Type.Object({ id: UUID }), response: { 204: Type.Null(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.meetings).where(eq(schema.meetings.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "meeting not found");
    emit("pmos.calendar.meetings.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── non-CRUD: ICS export (RFC 5545 VEVENT) ─────────────
  // Registered as a nested sub-plugin on `/meetings/:id` so the parametrised node and
  // its child are built by Fastify in one consistent radix subtree.

  const icsRoutes: FastifyPluginAsync = async (icsApp) => {
    const it = icsApp.withTypeProvider<TypeBoxTypeProvider>();
    it.get("/ics", {
      schema: { params: Type.Object({ id: UUID }), response: { 200: Type.String(), 404: Type.Any() } },
    }, async (req, reply) => {
      const [row] = await db.select().from(schema.meetings)
        .where(eq(schema.meetings.id, (req.params as any).id)).limit(1);
      if (!row) return fail(404, "NOT_FOUND", "meeting not found");
      const m = row as unknown as IcsMeeting;
      return reply
        .header("content-type", "text/calendar; charset=utf-8")
        .header("content-disposition", `attachment; filename="meeting-${m.id}.ics"`)
        .send(toIcs(m));
    });
  };

  app.register(icsRoutes, { prefix: "/meetings/:id" });
};
