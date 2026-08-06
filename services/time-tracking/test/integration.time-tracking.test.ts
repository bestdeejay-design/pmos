import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { timesheet, pomodoroSessions, taskProjects } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/time-tracking/v1";
const randomUUID = crypto.randomUUID();
const SEED_PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe.skipIf(!HAS_DB)("time-tracking (real Postgres): filters, stats, pomodoro", () => {
  let app: any;
  const taskX = randomUUID; // single task id reused across entries

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(timesheet);
    await db.delete(pomodoroSessions);
    await db.delete(taskProjects);
    // Seed the task→project cache (normally filled by NATS subscribers).
    await db.insert(taskProjects).values({
      taskId: taskX,
      taskTitle: "Test task",
      projectId: SEED_PROJECT_ID,
      projectName: "Test project",
    });
  });

  afterAll(async () => {
    await db.delete(timesheet);
    await db.delete(pomodoroSessions);
    await db.delete(taskProjects);
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

  it("stats returns total, todayTotal, weekTotal, perDay, byTask titles and byProject from cache", async () => {
    const r = await app.inject({ method: "GET", url: `${BASE}/timesheet/stats` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as any;
    // Today's entries sum to 3000 (the 30-day-old entry is outside today AND this week).
    expect(body.total).toBe(8000); // all time: 1000 (today, taskX) + 2000 (today, no task) + 5000 (old, taskX)
    expect(body.todayTotal).toBe(3000);
    expect(body.weekTotal).toBe(3000);

    // perDay: one row per calendar day (ascending), only within the requested range (here: all time).
    expect(Array.isArray(body.perDay)).toBe(true);
    const todayDate = new Date(Date.now() - 60_000).toISOString().slice(0, 10);
    const oldDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const daySum = Object.fromEntries(body.perDay.map((d: any) => [d.date, d.total]));
    expect(daySum[todayDate]).toBe(3000);
    expect(daySum[oldDate]).toBe(5000);

    expect(Array.isArray(body.byTask)).toBe(true);
    expect(body.byTask.length).toBe(1); // only taskX has durations (null taskId is excluded)
    expect(body.byTask[0].taskId).toBe(taskX);
    expect(body.byTask[0].taskTitle).toBe("Test task"); // from seeded task_projects cache
    expect(body.byTask[0].total).toBe(6000); // 1000 + 5000

    expect(Array.isArray(body.byProject)).toBe(true);
    expect(body.byProject).toEqual([
      { projectId: SEED_PROJECT_ID, projectName: "Test project", total: 6000 },
    ]);
  });

  it("stats total respects the from/to range", async () => {
    // Wide window around the two today entries (1000 + 2000), far from the 30-day-old entry.
    const from = new Date(Date.now() - 120_000).toISOString();
    const to = new Date(Date.now() + 120_000).toISOString();
    const r = await app.inject({ method: "GET", url: `${BASE}/timesheet/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as any;
    expect(body.total).toBe(3000); // only the two today entries are in range
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
