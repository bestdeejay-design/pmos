import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import * as schema from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("calendar (reference impl) — real Postgres", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/calendar/v1";
  beforeAll(async () => {
    app = await buildApp();
    // Isolate from data left by manual/E2E runs: clear the meetings table.
    await db.delete(schema.meetings);
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => { await app?.close(); });

  it("creates a meeting and returns it in list (generated-free reference pattern)", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Standup", startTime: "2026-08-01T09:00:00Z", endTime: "2026-08-01T09:15:00Z" } });
    expect(cr.statusCode, "create").toBe(201);
    const id = (cr.json() as any).id;
    const lr = await app.inject({ method: "GET", url: `${base}/meetings` });
    expect(lr.statusCode, "list").toBe(200);
    expect((lr.json() as any).data.some((m: any) => m.id === id)).toBe(true);
  });

  it("rejects endTime < startTime with 400", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Bad", startTime: "2026-08-01T10:00:00Z", endTime: "2026-08-01T09:00:00Z" } });
    expect(cr.statusCode, "bad range").toBe(400);
  });

  it("validates required fields (400)", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "No times" } });
    expect(cr.statusCode, "missing times").toBe(400);
  });

  it("filters by date range (from/to)", async () => {
    await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "August", startTime: "2026-08-10T12:00:00Z", endTime: "2026-08-10T13:00:00Z" } });
    await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "September", startTime: "2026-09-10T12:00:00Z", endTime: "2026-09-10T13:00:00Z" } });
    const r = await app.inject({ method: "GET", url: `${base}/meetings?from=2026-08-01T00:00:00Z&to=2026-08-31T23:59:59Z` });
    expect(r.statusCode).toBe(200);
    const titles = (r.json() as any).data.map((m: any) => m.title);
    expect(titles).toContain("August");
    expect(titles).not.toContain("September");
  });

  it("exports a meeting as RFC5545 ICS with recurrence", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Daily Sync", startTime: "2026-08-01T09:00:00Z", endTime: "2026-08-01T09:30:00Z", recurrence: "RRULE:FREQ=DAILY" } });
    const id = (cr.json() as any).id;
    const r = await app.inject({ method: "GET", url: `${base}/meetings/${id}/ics` });
    expect(r.statusCode, "ics status").toBe(200);
    const body = r.body;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Daily Sync");
    expect(body).toContain("RRULE:FREQ=DAILY");
    expect(body).toContain("DTSTART:20260801T090000Z");
    expect(body).toContain("END:VEVENT");
    expect(body).toContain("END:VCALENDAR");
    expect(r.headers["content-type"]).toContain("text/calendar");
  });

  it("deletes a meeting (204) and returns 404 on the next get", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Temp", startTime: "2026-08-02T09:00:00Z", endTime: "2026-08-02T09:15:00Z" } });
    const id = (cr.json() as any).id;
    const del = await app.inject({ method: "DELETE", url: `${base}/meetings/${id}` });
    expect(del.statusCode, "delete").toBe(204);
    const gt = await app.inject({ method: "GET", url: `${base}/meetings/${id}` });
    expect(gt.statusCode, "get after delete").toBe(404);
  });

  it("creates a reminder for a meeting and lists it (P2.5)", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Standup Rem", startTime: "2026-08-03T09:00:00Z", endTime: "2026-08-03T09:15:00Z" } });
    const id = (cr.json() as any).id;
    const rr = await app.inject({ method: "POST", url: `${base}/meetings/${id}/reminders`, payload: { remindAt: "2026-08-03T08:30:00Z", channel: "push" } });
    expect(rr.statusCode, "create reminder").toBe(201);
    const lr = await app.inject({ method: "GET", url: `${base}/meetings/${id}/reminders` });
    expect(lr.statusCode, "list reminders").toBe(200);
    const rows = (lr.json() as any).data;
    expect(rows.length).toBe(1);
    expect(new Date(rows[0].remindAt).toISOString()).toBe("2026-08-03T08:30:00.000Z");
    expect(rows[0].channel).toBe("push");
    expect(rows[0].sent).toBe(false);
  });

  it("returns 404 when creating a reminder for a missing meeting (P2.5)", async () => {
    const rr = await app.inject({ method: "POST", url: `${base}/meetings/00000000-0000-0000-0000-000000000000/reminders`, payload: { remindAt: "2026-08-03T08:00:00Z" } });
    expect(rr.statusCode, "missing meeting reminder").toBe(404);
  });

  describe("meeting conflict detection", () => {
    beforeEach(async () => {
      await db.delete(schema.meetings);
    });

    it("returns 201 with a warning about the overlapping meeting (TEST_CASES §4.4)", async () => {
      const m1 = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "m1", startTime: "2026-08-10T10:00:00Z", endTime: "2026-08-10T11:00:00Z" } });
      expect(m1.statusCode).toBe(201);
      const m1id = (m1.json() as any).id;

      const conflict = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Conflict meeting", startTime: "2026-08-10T10:30:00Z", endTime: "2026-08-10T11:30:00Z" } });
      expect(conflict.statusCode).toBe(201);
      const body = conflict.json() as any;
      expect(Array.isArray(body.warnings)).toBe(true);
      expect(body.warnings.length).toBe(1);
      expect(body.warnings[0].id).toBe(m1id);
      expect(body.warnings[0].title).toBe("m1");
      expect(new Date(body.warnings[0].startTime).toISOString()).toBe("2026-08-10T10:00:00.000Z");
      expect(new Date(body.warnings[0].endTime).toISOString()).toBe("2026-08-10T11:00:00.000Z");
    });

    it("returns empty warnings for a non-overlapping meeting", async () => {
      const r = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Free slot", startTime: "2026-08-11T11:00:00Z", endTime: "2026-08-11T12:00:00Z" } });
      expect(r.statusCode).toBe(201);
      expect((r.json() as any).warnings).toEqual([]);
    });

    it("detects conflicts on PATCH when the time moves into an overlap", async () => {
      const m2 = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "m2", startTime: "2026-08-12T09:00:00Z", endTime: "2026-08-12T10:00:00Z" } });
      const m2id = (m2.json() as any).id;
      await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "m3", startTime: "2026-08-12T09:30:00Z", endTime: "2026-08-12T10:30:00Z" } });

      const patch = await app.inject({ method: "PATCH", url: `${base}/meetings/${m2id}`, payload: { startTime: "2026-08-12T09:15:00Z", endTime: "2026-08-12T09:45:00Z" } });
      expect(patch.statusCode).toBe(200);
      const body = patch.json() as any;
      expect(body.warnings.length).toBe(1);
      expect(body.warnings[0].title).toBe("m3");
    });

    it("excludes the meeting itself from PATCH warnings (self not a conflict)", async () => {
      const m4 = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "m4", startTime: "2026-08-13T09:00:00Z", endTime: "2026-08-13T10:00:00Z" } });
      const m4id = (m4.json() as any).id;
      const patch = await app.inject({ method: "PATCH", url: `${base}/meetings/${m4id}`, payload: { title: "m4 renamed" } });
      expect(patch.statusCode).toBe(200);
      expect((patch.json() as any).warnings).toEqual([]);
    });

    it("keeps list responses free of the warnings field", async () => {
      const list = await app.inject({ method: "GET", url: `${base}/meetings` });
      expect(list.statusCode).toBe(200);
      for (const m of (list.json() as any).data) {
        expect(m).not.toHaveProperty("warnings");
      }
    });
  });
});
