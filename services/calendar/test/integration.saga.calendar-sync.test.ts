import { describe, it, beforeAll, afterAll, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EventBus } from "@pmos/event-bus";
import { buildApp as buildCalendarApp } from "../src/app.js";
import { buildApp as buildExternalCalendarsApp } from "../../external-calendars/src/app.js";
import * as calendarSchema from "../src/db/schema.js";
import * as externalCalendarsSchema from "../../external-calendars/src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const CAL_BASE = "/api/calendar/v1";
const EXT_BASE = "/api/external-calendars/v1";

// ICS fixture with 1 VEVENT
const ICS_FIXTURE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//pmos test//EN",
  "BEGIN:VEVENT",
  "UID:ev-saga-1@test",
  "DTSTART:20260801T100000Z",
  "DTEND:20260801T110000Z",
  "SUMMARY:Saga Sync Standup",
  "DESCRIPTION:Daily sync from external calendar",
  "LOCATION:Zoom",
  "RRULE:FREQ=DAILY",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// Helper to normalize timestamp format (PostgreSQL returns 'YYYY-MM-DD HH:MM:SS+00', we want ISO)
function normalizeTs(ts: string): string {
  return ts.replace(" ", "T").replace("+00", ".000Z");
}

describe.skipIf(!HAS_DB)("Saga 4: calendar sync with external provider (real Postgres + NATS)", () => {
  let calendarApp: Awaited<ReturnType<typeof buildCalendarApp>>;
  let externalCalendarsApp: Awaited<ReturnType<typeof buildExternalCalendarsApp>>;
  let icsServer: Server;
  let icsPort = 0;
  let calendarId: string;

  // Separate DB connections with correct schemas
  let calendarDb: ReturnType<typeof drizzle>;
  let externalCalendarsDb: ReturnType<typeof drizzle>;
  let calendarClient: ReturnType<typeof postgres>;
  let externalCalendarsClient: ReturnType<typeof postgres>;

  const TEST_CALENDAR_NAMES = ["Saga Test Calendar", "Idempotency Test Calendar", "Pre-linked Calendar"];

  // Delete ONLY rows created by this suite (by calendar displayName): vitest runs
  // integration.calendar.test.ts in parallel against the same calendar_ schema.
  async function cleanupOwnData(): Promise<void> {
    const cals = await externalCalendarsDb
      .select({ id: externalCalendarsSchema.externalCalendars.id })
      .from(externalCalendarsSchema.externalCalendars)
      .where(inArray(externalCalendarsSchema.externalCalendars.displayName, TEST_CALENDAR_NAMES));
    if (cals.length === 0) return;
    const calIds = cals.map((c) => c.id);
    const evts = await externalCalendarsDb
      .select({ id: externalCalendarsSchema.externalEvents.id })
      .from(externalCalendarsSchema.externalEvents)
      .where(inArray(externalCalendarsSchema.externalEvents.externalCalendarId, calIds));
    const evtIds = evts.map((e) => e.id);
    if (evtIds.length > 0) {
      await calendarDb.delete(calendarSchema.meetings)
        .where(inArray(calendarSchema.meetings.linkedExternalEventId, evtIds));
    }
    await externalCalendarsDb.delete(externalCalendarsSchema.externalEvents)
      .where(inArray(externalCalendarsSchema.externalEvents.externalCalendarId, calIds));
    await externalCalendarsDb.delete(externalCalendarsSchema.externalCalendars)
      .where(inArray(externalCalendarsSchema.externalCalendars.id, calIds));
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL!;

    // Calendar DB connection with calendar_ schema
    calendarClient = postgres(url, { onnotice: () => {} });
    await calendarClient.unsafe(`SET search_path TO "calendar_"`);
    calendarDb = drizzle(calendarClient, { schema: calendarSchema });

    // External-calendars DB connection with calendar_ schema (same for test)
    externalCalendarsClient = postgres(url, { onnotice: () => {} });
    await externalCalendarsClient.unsafe(`SET search_path TO "calendar_"`);
    externalCalendarsDb = drizzle(externalCalendarsClient, { schema: externalCalendarsSchema });

    // Start local ICS HTTP server
    icsServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/calendar" });
      res.end(ICS_FIXTURE);
    });
    await new Promise<void>((resolve) => icsServer.listen(0, "127.0.0.1", resolve));
    const addr = icsServer.address();
    if (addr && typeof addr === "object") icsPort = addr.port;

    // Build both apps so subscribers are live
    calendarApp = await buildCalendarApp();
    externalCalendarsApp = await buildExternalCalendarsApp();
    await calendarApp.ready();
    await externalCalendarsApp.ready();

    // Remove leftovers from previous runs of THIS suite only
    await cleanupOwnData();

    // Create external calendar pointing to our ICS server
    const created = await externalCalendarsApp.inject({
      method: "POST",
      url: `${EXT_BASE}/calendars`,
      payload: {
        displayName: "Saga Test Calendar",
        provider: "ics",
        syncEnabled: true,
        authData: { url: `http://127.0.0.1:${icsPort}/calendar.ics` },
      },
    });
    expect(created.statusCode).toBe(201);
    calendarId = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    // Cleanup ONLY this suite's rows (parallel integration.calendar.test.ts rows untouched)
    await cleanupOwnData().catch(() => {});
    if (calendarApp) await calendarApp.close();
    if (externalCalendarsApp) await externalCalendarsApp.close();
    await calendarClient.end().catch(() => {});
    await externalCalendarsClient.end().catch(() => {});
    await new Promise<void>((resolve) => icsServer.close(() => resolve()));
  });

  it("Test 1: end-to-end ICS sync → external_events.created → calendar meeting created", async () => {
    // Trigger sync on external-calendars
    const syncRes = await externalCalendarsApp.inject({
      method: "POST",
      url: `${EXT_BASE}/calendars/sync/${calendarId}`,
    });
    expect(syncRes.statusCode).toBe(200);
    const syncBody = syncRes.json() as { synced: number; total: number };
    expect(syncBody.synced).toBe(1);
    expect(syncBody.total).toBe(1);

    // Verify external-calendars created external_events row
    const extEvents = await externalCalendarsDb
      .select()
      .from(externalCalendarsSchema.externalEvents)
      .where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, calendarId));
    expect(extEvents).toHaveLength(1);
    const extEvent = extEvents[0];
    expect(extEvent.summary).toBe("Saga Sync Standup");
    expect(extEvent.startTime).toBe("2026-08-01T10:00:00.000Z");
    expect(extEvent.endTime).toBe("2026-08-01T11:00:00.000Z");
    expect(extEvent.recurrenceRule).toBe("FREQ=DAILY");
    expect(extEvent.location).toBe("Zoom");
    expect(extEvent.externalEventId).toBe("ev-saga-1@test");

    // Wait for event propagation and calendar consumer to process
    await new Promise((r) => setTimeout(r, 3000));

    // Verify calendar created a meeting linked to the external event
    const calMeetings = await calendarDb
      .select()
      .from(calendarSchema.meetings)
      .where(eq(calendarSchema.meetings.linkedExternalEventId, extEvent.id));
    expect(calMeetings).toHaveLength(1);
    const meeting = calMeetings[0];
    expect(meeting.title).toBe("Saga Sync Standup");
    expect(meeting.description).toBe("Daily sync from external calendar");
    expect(normalizeTs(meeting.startTime)).toBe("2026-08-01T10:00:00.000Z");
    expect(normalizeTs(meeting.endTime)).toBe("2026-08-01T11:00:00.000Z");
    expect(meeting.location).toBe("Zoom");
    expect(meeting.recurrence).toBe("FREQ=DAILY");
    expect(meeting.linkedExternalEventId).toBe(extEvent.id);
  });

  it("Test 2: idempotency — second sync creates no duplicate meeting", async () => {
    // Create a NEW external calendar for this test (so first sync does INSERT)
    const created = await externalCalendarsApp.inject({
      method: "POST",
      url: `${EXT_BASE}/calendars`,
      payload: {
        displayName: "Idempotency Test Calendar",
        provider: "ics",
        syncEnabled: true,
        authData: { url: `http://127.0.0.1:${icsPort}/calendar.ics` },
      },
    });
    expect(created.statusCode).toBe(201);
    const testCalendarId = (created.json() as { id: string }).id;

    // First sync (INSERT → event emitted → meeting created)
    await externalCalendarsApp.inject({ method: "POST", url: `${EXT_BASE}/calendars/sync/${testCalendarId}` });
    await new Promise((r) => setTimeout(r, 2000));

    // Verify meeting was created
    const extEventsAfterFirst = await externalCalendarsDb
      .select()
      .from(externalCalendarsSchema.externalEvents)
      .where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, testCalendarId));
    expect(extEventsAfterFirst).toHaveLength(1);
    const extEvent = extEventsAfterFirst[0];
    const meetingsAfterFirst = await calendarDb
      .select()
      .from(calendarSchema.meetings)
      .where(eq(calendarSchema.meetings.linkedExternalEventId, extEvent.id));
    expect(meetingsAfterFirst).toHaveLength(1);

    // Second sync (UPDATE → no event emitted)
    const syncRes2 = await externalCalendarsApp.inject({ method: "POST", url: `${EXT_BASE}/calendars/sync/${testCalendarId}` });
    expect(syncRes2.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));

    // Verify external_events still has 1 row (upsert)
    const extEvents = await externalCalendarsDb
      .select()
      .from(externalCalendarsSchema.externalEvents)
      .where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, testCalendarId));
    expect(extEvents).toHaveLength(1);

    // Verify calendar still has exactly 1 meeting for that externalEventId (no duplicate)
    const calMeetings = await calendarDb
      .select()
      .from(calendarSchema.meetings)
      .where(eq(calendarSchema.meetings.linkedExternalEventId, extEvent.id));
    expect(calMeetings).toHaveLength(1);

    // Cleanup
    await externalCalendarsDb.delete(externalCalendarsSchema.externalEvents).where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, testCalendarId));
    await externalCalendarsDb.delete(externalCalendarsSchema.externalCalendars).where(eq(externalCalendarsSchema.externalCalendars.id, testCalendarId));
  });

  it("Test 3: skip when already linked — pre-insert meeting with linkedExternalEventId", async () => {
    // Create a separate external calendar and sync to get an externalEventId
    const created = await externalCalendarsApp.inject({
      method: "POST",
      url: `${EXT_BASE}/calendars`,
      payload: {
        displayName: "Pre-linked Calendar",
        provider: "ics",
        syncEnabled: true,
        authData: { url: `http://127.0.0.1:${icsPort}/calendar.ics` },
      },
    });
    expect(created.statusCode).toBe(201);
    const preLinkedCalendarId = (created.json() as { id: string }).id;

    await externalCalendarsApp.inject({ method: "POST", url: `${EXT_BASE}/calendars/sync/${preLinkedCalendarId}` });
    await new Promise((r) => setTimeout(r, 1500));

    const [extEvent] = await externalCalendarsDb
      .select()
      .from(externalCalendarsSchema.externalEvents)
      .where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, preLinkedCalendarId))
      .limit(1);

    // Delete the meeting that was created by the first sync's event
    await calendarDb.delete(calendarSchema.meetings).where(eq(calendarSchema.meetings.linkedExternalEventId, extEvent.id));

    // Pre-insert a meeting with the same linkedExternalEventId
    await calendarDb.insert(calendarSchema.meetings).values({
      title: "Pre-existing Meeting",
      startTime: "2026-08-01T10:00:00.000Z",
      endTime: "2026-08-01T11:00:00.000Z",
      linkedExternalEventId: extEvent.id,
    });

    // Manually publish the event to test idempotency (same externalEventId, new event envelope ID)
    const bus = EventBus.get();
    await bus.publish("pmos.external-calendars.external_events.created", {
      externalCalendarId: preLinkedCalendarId,
      externalEventId: extEvent.id,
      summary: "Saga Sync Standup",
      description: "Daily sync from external calendar",
      startTime: "2026-08-01T10:00:00.000Z",
      endTime: "2026-08-01T11:00:00.000Z",
      recurrenceRule: "FREQ=DAILY",
      location: "Zoom",
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify only 1 meeting exists for that externalEventId (the pre-existing one)
    const calMeetings = await calendarDb
      .select()
      .from(calendarSchema.meetings)
      .where(eq(calendarSchema.meetings.linkedExternalEventId, extEvent.id));
    expect(calMeetings).toHaveLength(1);
    expect(calMeetings[0].title).toBe("Pre-existing Meeting");

    // Cleanup pre-linked calendar
    await externalCalendarsDb.delete(externalCalendarsSchema.externalEvents).where(eq(externalCalendarsSchema.externalEvents.externalCalendarId, preLinkedCalendarId));
    await externalCalendarsDb.delete(externalCalendarsSchema.externalCalendars).where(eq(externalCalendarsSchema.externalCalendars.id, preLinkedCalendarId));
  });
});
