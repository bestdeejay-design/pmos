import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("tasks semantics (integration, needs Postgres)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/tasks/v1";

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("creates a task, filters, completes (streak) and reorders priorities", async () => {
    const c = await app.inject({ method: "POST", url: `${base}/tasks`, payload: { title: "Write spec", priority: 5 } });
    expect(c.statusCode).toBe(201);
    const task = c.json();

    // filter by status
    const list = await app.inject({ method: "GET", url: `${base}/tasks?status=todo` });
    expect(list.json().data.some((t: any) => t.id === task.id)).toBe(true);

    // complete -> streak bumps
    const done = await app.inject({ method: "PATCH", url: `${base}/tasks/${task.id}`, payload: { status: "done" } });
    expect(done.json().currentStreak).toBe(1);
    expect(done.json().bestStreak).toBe(1);
    expect(done.json().completedAt).toBeTruthy();

    // priorities endpoint returns it
    const pri = await app.inject({ method: "GET", url: `${base}/priorities` });
    expect(pri.json().data.some((t: any) => t.id === task.id)).toBe(true);

    // reorder persists sortOrder
    const reorder = await app.inject({ method: "PUT", url: `${base}/priorities/order`, payload: { orderedIds: [task.id] } });
    expect(reorder.json().ok).toBe(true);
    const got = await app.inject({ method: "GET", url: `${base}/tasks/${task.id}` });
    expect(got.json().sortOrder).toBe(0);
  });

  it("soft-deletes a task (hidden from default list, still fetchable)", async () => {
    const c = await app.inject({ method: "POST", url: `${base}/tasks`, payload: { title: "Temp" } });
    const id = c.json().id;
    const del = await app.inject({ method: "DELETE", url: `${base}/tasks/${id}` });
    expect(del.statusCode).toBe(204);
    const got = await app.inject({ method: "GET", url: `${base}/tasks/${id}` });
    expect(got.json().isArchived).toBe(true);
    const list = await app.inject({ method: "GET", url: `${base}/tasks` });
    expect(list.json().data.some((t: any) => t.id === id)).toBe(false);
  });
});
