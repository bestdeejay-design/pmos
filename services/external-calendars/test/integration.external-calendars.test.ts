import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { externalCalendars, externalEvents } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/external-calendars/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//pmos test//EN",
  "BEGIN:VEVENT",
  "UID:ev-1@test",
  "DTSTART:20260701T100000Z",
  "DTEND:20260701T110000Z",
  "SUMMARY:Standup",
  "DESCRIPTION:Daily sync",
  "LOCATION:Zoom",
  "RRULE:FREQ=DAILY",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ev-2@test",
  "DTSTART;VALUE=DATE:20260705",
  "SUMMARY:All-day",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe.skipIf(!HAS_DB)("external-calendars (real Postgres): ICS sync + link", () => {
  let app: any;
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/calendar" });
      res.end(ICS);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;

    app = await buildApp();
    await app.ready();
    await db.delete(externalEvents);
    await db.delete(externalCalendars);
  });

  afterAll(async () => {
    await db.delete(externalEvents).catch(() => {});
    await db.delete(externalCalendars).catch(() => {});
    if (app) await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("syncs an ICS calendar and creates external events once", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/calendars`,
      payload: { displayName: "Work", provider: "ics", syncEnabled: true, authData: { url: `http://127.0.0.1:${port}/work.ics` } },
    });
    expect(created.statusCode).toBe(201);
    const calendarId = (created.json() as { id: string }).id;

    const res = await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.synced).toBe(2);
    expect(body.total).toBe(2);

    const events = await db.select().from(externalEvents).where(eq(externalEvents.externalCalendarId, calendarId));
    expect(events).toHaveLength(2);
    const standup = events.find((e) => e.externalEventId === "ev-1@test");
    expect(standup?.summary).toBe("Standup");
    expect(standup?.startTime).toBe("2026-07-01T10:00:00.000Z");
    expect(standup?.endTime).toBe("2026-07-01T11:00:00.000Z");
    expect(standup?.recurrenceRule).toBe("FREQ=DAILY");
    expect(standup?.location).toBe("Zoom");
    expect(events.find((e) => e.externalEventId === "ev-2@test")?.startTime).toBe("2026-07-05T00:00:00.000Z");

    // idempotent second sync — updates, no new rows
    const again = await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { synced: number }).synced).toBe(2);
    const after = await db.select().from(externalEvents).where(eq(externalEvents.externalCalendarId, calendarId));
    expect(after).toHaveLength(2);
  });

  it("GET /calendars/:id/events lists events", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/calendars`,
      payload: { displayName: "List", provider: "ics", syncEnabled: true, authData: { url: `http://127.0.0.1:${port}/list.ics` } },
    });
    const calendarId = (created.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });

    const res = await app.inject({ method: "GET", url: `${BASE}/calendars/${calendarId}/events` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it("PATCH /calendars/events/:id/link sets linkedMeetingId", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/calendars`,
      payload: { displayName: "Link", provider: "ics", syncEnabled: true, authData: { url: `http://127.0.0.1:${port}/link.ics` } },
    });
    const calendarId = (created.json() as { id: string }).id;
    await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });

    const [ev] = await db.select().from(externalEvents).where(eq(externalEvents.externalCalendarId, calendarId)).limit(1);
    const meetingId = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `${BASE}/calendars/events/${ev!.id}/link`,
      payload: { meetingId },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db.select().from(externalEvents).where(eq(externalEvents.id, ev!.id)).limit(1);
    expect(row?.linkedMeetingId).toBe(meetingId);
  });

  it("sync of an unreachable URL degrades gracefully (502)", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/calendars`,
      payload: { displayName: "Dead", provider: "ics", syncEnabled: true, authData: { url: "http://127.0.0.1:9/dead.ics" } },
    });
    const calendarId = (created.json() as { id: string }).id;
    const res = await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { code: string }).code).toBe("ICS_UNAVAILABLE");
  });

  it("google/yandex providers degrade with PROVIDER_NOT_CONFIGURED", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/calendars`,
      payload: { displayName: "G", provider: "google", syncEnabled: true, authData: {} },
    });
    const calendarId = (created.json() as { id: string }).id;
    const res = await app.inject({ method: "POST", url: `${BASE}/calendars/sync/${calendarId}` });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { code: string }).code).toBe("PROVIDER_NOT_CONFIGURED");
  });
});
