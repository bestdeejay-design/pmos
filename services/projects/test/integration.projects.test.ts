import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { projects, projectItems, processedEvents } from "../src/db/schema.js";
import { upsertProjectItem } from "../src/events/subscribe.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/projects/v1";

async function createProject(app: any, name = "Тест"): Promise<string> {
  const res = await app.inject({ method: "POST", url: `${BASE}/projects`, payload: { name } });
  expect(res.statusCode).toBe(201);
  return (res.json() as any).id as string;
}

describe.skipIf(!HAS_DB)("projects (real Postgres): dashboard items + gantt", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(projectItems);
    await db.delete(processedEvents);
    await db.delete(projects);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("GET /projects/:id/items returns grouped empty arrays when no items", async () => {
    const projectId = await createProject(app);
    const res = await app.inject({ method: "GET", url: `${BASE}/projects/${projectId}/items` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notes: [], tasks: [], meetings: [], files: [] });
  });

  it("GET /projects/:id/items groups project_items by entityType", async () => {
    const projectId = await createProject(app);
    const taskId = randomUUID();
    const noteId = randomUUID();
    await upsertProjectItem({ projectId, entityType: "task", entityId: taskId, title: "Задача 1", startDate: "2026-08-01T09:00:00Z", status: "todo", payload: { dependencies: [] } });
    await upsertProjectItem({ projectId, entityType: "note", entityId: noteId, title: "Заметка 1", payload: { tags: [] } });

    const res = await app.inject({ method: "GET", url: `${BASE}/projects/${projectId}/items` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].entityId).toBe(taskId);
    expect(body.tasks[0].title).toBe("Задача 1");
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].entityId).toBe(noteId);
    expect(body.meetings).toEqual([]);
    expect(body.files).toEqual([]);
  });

  it("GET /projects/:id/gantt returns tasks with dates and empty dependencies", async () => {
    const projectId = await createProject(app);
    const taskId = randomUUID();
    await upsertProjectItem({
      projectId,
      entityType: "task",
      entityId: taskId,
      title: "Разработать макет",
      startDate: "2026-08-03T08:00:00Z",
      status: "in_progress",
      payload: { deadline: "2026-08-10T18:00:00Z" },
    });
    await upsertProjectItem({ projectId, entityType: "note", entityId: randomUUID(), title: "Не задача", payload: {} });

    const res = await app.inject({ method: "GET", url: `${BASE}/projects/${projectId}/gantt` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toEqual({
      id: taskId,
      title: "Разработать макет",
      start: "2026-08-03T08:00:00Z",
      end: "2026-08-10T18:00:00Z",
      dependencies: [],
    });
  });

  it("GET /projects/:id/gantt surfaces dependencies from payload when present", async () => {
    const projectId = await createProject(app);
    await upsertProjectItem({
      projectId,
      entityType: "task",
      entityId: randomUUID(),
      title: "Зависимая задача",
      startDate: "2026-08-04T08:00:00Z",
      status: "todo",
      payload: { dependencies: [{ taskId: randomUUID() }] },
    });
    const res = await app.inject({ method: "GET", url: `${BASE}/projects/${projectId}/gantt` });
    const body = res.json();
    expect(body.tasks[0].dependencies).toHaveLength(1);
  });

  it("404 when project does not exist (items and gantt)", async () => {
    const missing = randomUUID();
    const items = await app.inject({ method: "GET", url: `${BASE}/projects/${missing}/items` });
    expect(items.statusCode).toBe(404);
    const gantt = await app.inject({ method: "GET", url: `${BASE}/projects/${missing}/gantt` });
    expect(gantt.statusCode).toBe(404);
  });
});
