import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { timesheet, pomodoroSessions } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/time-tracking/v1";
const randomUUID = crypto.randomUUID();

describe.skipIf(!HAS_DB)("time-tracking (real Postgres): filters, stats, pomodoro", () => {
  let app: any;
  const taskX = randomUUID; // single task id reused across entries

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(timesheet);
    await db.delete(pomodoroSessions);
  });

  afterAll(async () => {
    await db.delete(timesheet);
    await db.delete(pomodoroSessions);
    if (app) await app.close();
  });

  async function addEntry(taskId: string | null, durationSec: number, startedAt: string) {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/timesheet`,
      payload: { taskId, durationSec, startedAt, description: `entry ${durationSec}` },
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as any).id;
  }

  it("timesheet filters by taskId, from and to", async () => {
    const now = Date.now();
    const todayA = new Date(now - 60_000).toISOString();
    const todayB = new Date(now + 60_000).toISOString();
    const oldEntry = new Date(now - 30 * 86400_000).toISOString();
    await addEntry(taskX, 1000, todayA);
    await addEntry(null, 2000, todayB);
    await addEntry(taskX, 5000, oldEntry);

    // taskId filter
    const byTask = await app.inject({ method: "GET", url: `${BASE}/timesheet?taskId=${taskX}` });
    expect(byTask.statusCode).toBe(200);
    const taskRows = (byTask.json() as any).data as any[];
    expect(taskRows.length).toBeGreaterThan(0);
    expect(taskRows.every((t) => t.taskId === taskX)).toBe(true);

    // from/to range filter on startedAt
    const range = await app.inject({
      method: "GET",
      url: `${BASE}/timesheet?from=${todayA}&to=${todayB}`,
    });
    expect(range.statusCode).toBe(200);
    const rangeRows = (range.json() as any).data as any[];
    expect(rangeRows.length).toBe(2); // both today entries, not the old one
    expect(rangeRows.every((t) => new Date(t.startedAt).getTime() >= new Date(todayA).getTime())).toBe(true);
  });

  it("stats returns todayTotal, weekTotal, byTask and empty byProject", async () => {
    const r = await app.inject({ method: "GET", url: `${BASE}/timesheet/stats` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as any;
    // Today's entries sum to 3000 (the 30-day-old entry is outside today AND this week).
    expect(body.todayTotal).toBe(3000);
    expect(body.weekTotal).toBe(3000);
    expect(Array.isArray(body.byTask)).toBe(true);
    expect(body.byTask.length).toBe(1); // only taskX has durations (null taskId is excluded)
    expect(body.byTask[0].taskId).toBe(taskX);
    expect(body.byTask[0].total).toBe(6000); // 1000 + 5000
    expect(body.byProject).toEqual({});
  });

  it("pomodoro: start, list, complete with computed completedMin", async () => {
    const start = await app.inject({
      method: "POST",
      url: `${BASE}/pomodoro`,
      payload: { mode: "pomodoro", plannedMin: 25, taskId: taskX },
    });
    expect(start.statusCode).toBe(201);
    const sess = start.json() as any;
    expect(sess.mode).toBe("pomodoro");
    expect(sess.startedAt).toBeTruthy();
    expect(sess.completed).toBe(false);

    const complete = await app.inject({
      method: "PATCH",
      url: `${BASE}/pomodoro/${sess.id}`,
      payload: { completed: true },
    });
    expect(complete.statusCode).toBe(200);
    const done = complete.json() as any;
    expect(done.completed).toBe(true);
    expect(done.endedAt).toBeTruthy();
    expect(typeof done.completedMin).toBe("number");
    expect(done.completedMin).toBeGreaterThanOrEqual(0);

    const list = await app.inject({ method: "GET", url: `${BASE}/pomodoro` });
    expect(list.statusCode).toBe(200);
    const data = (list.json() as any).data as any[];
    expect(data.some((p) => p.id === sess.id)).toBe(true);
  });

  it("pomodoro rejects an unknown mode with 400", async () => {
    const r = await app.inject({ method: "POST", url: `${BASE}/pomodoro`, payload: { mode: "nope" } });
    expect(r.statusCode).toBe(400);
  });
});
