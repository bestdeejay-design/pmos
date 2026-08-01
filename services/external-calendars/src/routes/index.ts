import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { parseIcs } from "../lib/ics.js";

function emit(subject: string, data: unknown, correlationId?: string): void {
  try {
    EventBus.get().publish(subject, data, correlationId ? { correlationId } : undefined).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

const FETCH_TIMEOUT = 10_000;

async function fetchIcs(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`ics fetch failed: HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// auth_data is jsonb: either { url } or a bare url string.
function icsUrl(cal: { authData: unknown }): string | null {
  const auth = cal.authData;
  if (typeof auth === "string" && auth.trim()) return auth.trim();
  if (auth && typeof auth === "object") {
    const url = (auth as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return null;
}

export const external_calendarsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "external-calendars" }));

  // ───────────── calendars CRUD (reference pattern) ─────────────
  typed.get("/calendars", {
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
    const rows = await db.select().from(schema.externalCalendars)
      .orderBy(asc(schema.externalCalendars.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.externalCalendars);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/calendars", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.externalCalendars).values(req.body as any).returning();
    if (!row) return fail(500, "INTERNAL_ERROR", "insert failed");
    emit("pmos.external-calendars.calendars.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "calendars not found");
    return reply.send(row);
  });

  typed.patch("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.externalCalendars).set(patch)
      .where(eq(schema.externalCalendars.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "calendars not found");
    emit("pmos.external-calendars.calendars.updated", row);
    return reply.send(row);
  });

  typed.delete("/calendars/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.externalCalendars).where(eq(schema.externalCalendars.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "calendars not found");
    emit("pmos.external-calendars.calendars.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── sync ─────────────
  typed.post("/calendars/sync/:id", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: { 200: Type.Any(), 404: Type.Any(), 502: Type.Any() },
    },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const [cal] = await db.select().from(schema.externalCalendars)
      .where(eq(schema.externalCalendars.id, (req.params as any).id)).limit(1);
    if (!cal) return fail(404, "NOT_FOUND", "calendar not found");

    const provider = (cal.provider ?? "").toLowerCase();
    if (provider === "google" || provider === "yandex") {
      // Real OAuth needs a user token exchange; out of scope for tests.
      return reply.code(502).send({ code: "PROVIDER_NOT_CONFIGURED", message: `${provider} requires an OAuth token — not configured` });
    }

    const url = icsUrl(cal);
    if (!url) {
      return reply.code(502).send({ code: "PROVIDER_NOT_CONFIGURED", message: "calendar has no ICS url in authData" });
    }

    let text: string;
    try {
      text = await fetchIcs(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log?.error?.({ calendarId: cal.id, err }, "external-calendars sync fetch failed");
      return reply.code(502).send({ code: "ICS_UNAVAILABLE", message });
    }

    const events = parseIcs(text);
    let synced = 0;
    for (const ev of events) {
      const values = {
        summary: ev.summary,
        description: ev.description,
        startTime: ev.startTime,
        endTime: ev.endTime,
        recurrenceRule: ev.recurrenceRule,
        location: ev.location,
      };
      const [existing] = await db.select().from(schema.externalEvents)
        .where(and(
          eq(schema.externalEvents.externalCalendarId, cal.id),
          eq(schema.externalEvents.externalEventId, ev.uid),
        )).limit(1);
      if (existing) {
        await db.update(schema.externalEvents).set(values).where(eq(schema.externalEvents.id, existing.id));
      } else {
        const [created] = await db.insert(schema.externalEvents).values({
          externalCalendarId: cal.id,
          externalEventId: ev.uid,
          ...values,
        }).returning();
        if (created) {
          emit("pmos.external-calendars.external_events.created", {
            externalCalendarId: cal.id,
            externalEventId: created.id,
            summary: ev.summary,
            description: ev.description,
            startTime: ev.startTime,
            endTime: ev.endTime,
            recurrenceRule: ev.recurrenceRule,
            location: ev.location,
            correlationId,
          }, correlationId);
        }
      }
      synced += 1;
    }

    await db.update(schema.externalCalendars)
      .set({ lastSyncAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.externalCalendars.id, cal.id));

    return reply.send({ synced, total: events.length, syncedEvents: synced });
  });

  // ───────────── events ─────────────
  typed.get("/calendars/:id/events", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: { 200: Type.Object({ data: Type.Array(Type.Any()) }), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const [cal] = await db.select().from(schema.externalCalendars)
      .where(eq(schema.externalCalendars.id, (req.params as any).id)).limit(1);
    if (!cal) return fail(404, "NOT_FOUND", "calendar not found");
    const rows = await db.select().from(schema.externalEvents)
      .where(eq(schema.externalEvents.externalCalendarId, cal.id))
      .orderBy(asc(schema.externalEvents.startTime));
    return reply.send({ data: rows });
  });

  typed.patch("/calendars/events/:id/link", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ meetingId: Type.String({ format: "uuid" }) }),
      response: { 200: Type.Object({ ok: Type.Boolean() }), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const body = req.body as any;
    const [ev] = await db.select().from(schema.externalEvents)
      .where(eq(schema.externalEvents.id, (req.params as any).id)).limit(1);
    if (!ev) return fail(404, "NOT_FOUND", "external event not found");
    await db.update(schema.externalEvents)
      .set({ linkedMeetingId: body.meetingId })
      .where(eq(schema.externalEvents.id, ev.id));
    emit("pmos.external-calendars.external_event.linked", {
      externalEventId: ev.id,
      meetingId: body.meetingId,
      correlationId,
    }, correlationId);
    return reply.send({ ok: true });
  });
};
