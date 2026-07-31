import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { tasks, taskDependencies } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/tasks/v1";

describe.skipIf(!HAS_DB)("tasks (real Postgres): dependencies + recurrence", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(taskDependencies);
    await db.delete(tasks);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("blocks closing a task whose blocker is not done (409)", async () => {
    const blocker = await app.inject({ method: "POST", url: `${BASE}/tasks`, payload: { title: "Blocker", status: "todo" } });
    const dep = await app.inject({ method: "POST", url: `${BASE}/tasks`, payload: { title: "Dependent", status: "in_progress" } });
    const blockerId = (blocker.json() as any).id;
    const depId = (dep.json() as any).id;

    const link = await app.inject({
      method: "POST",
      url: `${BASE}/tasks/${depId}/dependencies`,
      payload: { dependsOnId: blockerId },
    });
    expect(link.statusCode).toBe(201);

    const close = await app.inject({ method: "PATCH", url: `${BASE}/tasks/${depId}`, payload: { status: "done" } });
    expect(close.statusCode).toBe(409);
  });

  it("allows closing once the blocker is done", async () => {
    const blocker = await app.inject({ method: "POST", url: `${BASE}/tasks`, payload: { title: "Blocker2", status: "todo" } });
    const dep = await app.inject({ method: "POST", url: `${BASE}/tasks`, payload: { title: "Dependent2", status: "in_progress" } });
    const blockerId = (blocker.json() as any).id;
    const depId = (dep.json() as any).id;
    await app.inject({ method: "POST", url: `${BASE}/tasks/${depId}/dependencies`, payload: { dependsOnId: blockerId } });

    const closeBlocker = await app.inject({ method: "PATCH", url: `${BASE}/tasks/${blockerId}`, payload: { status: "done" } });
    expect(closeBlocker.statusCode).toBe(200);
    const closeDep = await app.inject({ method: "PATCH", url: `${BASE}/tasks/${depId}`, payload: { status: "done" } });
    expect(closeDep.statusCode).toBe(200);
  });

  it("spawns next recurrence instance on close", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/tasks`,
      payload: { title: "Daily standup", status: "in_progress", recurrence: "FREQ=DAILY", deadline: "2026-08-01T09:00:00Z" },
    });
    const id = (r.json() as any).id;
    const close = await app.inject({ method: "PATCH", url: `${BASE}/tasks/${id}`, payload: { status: "done" } });
    expect(close.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: `${BASE}/tasks?recurrence=FREQ=DAILY` });
    const data = (list.json() as any).data as any[];
    const spawned = data.filter((t: any) => t.title === "Daily standup" && t.status === "todo");
    expect(spawned.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects unknown Kanban status (400)", async () => {
    const r = await app.inject({ method: "POST", url: `${BASE}/tasks`, payload: { title: "X" } });
    const id = (r.json() as any).id;
    const bad = await app.inject({ method: "PATCH", url: `${BASE}/tasks/${id}`, payload: { status: "frozen" } });
    expect(bad.statusCode).toBe(400);
  });
});
