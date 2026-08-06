import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import * as schema from "../src/db/schema.js";
import { EventBus } from "@pmos/event-bus";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_NATS = Boolean(process.env.NATS_URL);

describe.skipIf(!HAS_DB)("agent — real Postgres", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/agent/v1";

  beforeAll(async () => {
    app = await buildApp();
    // Isolate from data left by manual/E2E runs.
    await db.delete(schema.agentMessages);
    await db.delete(schema.processedEvents);
    await db.delete(schema.dailyEvents);
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => { await app?.close(); });

  it("GET /agent/inbox returns empty inbox with pagination", async () => {
    const r = await app.inject({ method: "GET", url: `${base}/agent/inbox` });
    expect(r.statusCode, "inbox status").toBe(200);
    const body = r.json() as { data: unknown[]; pagination: { offset: number; limit: number; total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination.total).toBe(0);
  });

  it("POST /agent/respond with unknown messageId returns 404", async () => {
    const r = await app.inject({
      method: "POST", url: `${base}/agent/respond`,
      payload: { messageId: "00000000-0000-4000-8000-000000000000", action: "accept" },
    });
    expect(r.statusCode, "unknown message").toBe(404);
  });

  it("POST /agent/respond with invalid action returns 400", async () => {
    const [msg] = await db.insert(schema.agentMessages).values({
      title: "Test", body: "body", type: "suggestion", source: "test",
    }).returning();
    const r = await app.inject({
      method: "POST", url: `${base}/agent/respond`,
      payload: { messageId: msg.id, action: "explode" },
    });
    expect(r.statusCode, "bad action").toBe(400);
  });

  it("POST /agent/respond accept flips status and replies are stored in actions", async () => {
    const [msg] = await db.insert(schema.agentMessages).values({
      title: "Meeting", body: "Reminder", type: "trigger", source: "test",
    }).returning();
    const r = await app.inject({
      method: "POST", url: `${base}/agent/respond`,
      payload: { messageId: msg.id, action: "reply", reply: "Понял, приду" },
    });
    expect(r.statusCode, "reply status").toBe(200);
    const [after] = await db.select().from(schema.agentMessages).where(
      (await import("drizzle-orm")).eq(schema.agentMessages.id, msg.id),
    ).limit(1);
    expect(after.status).toBe("accepted");
    expect(Array.isArray(after.actions)).toBe(true);
    expect((after.actions as { label: string }[])[0]?.label).toBe("Понял, приду");
  });

  it("POST /agent/dismiss-all dismisses pending messages", async () => {
    await db.delete(schema.agentMessages);
    await db.insert(schema.agentMessages).values([
      { title: "A", body: "a", type: "digest" },
      { title: "B", body: "b", type: "digest" },
    ]);
    const r = await app.inject({ method: "POST", url: `${base}/agent/dismiss-all` });
    expect(r.statusCode, "dismiss-all").toBe(200);
    expect((r.json() as { dismissed: number }).dismissed).toBe(2);
    const remaining = await db.select().from(schema.agentMessages).where(
      (await import("drizzle-orm")).eq(schema.agentMessages.status, "pending"),
    );
    expect(remaining.length).toBe(0);
  });

  it("GET /today and /week include seeded messages, meetings and tasks", async () => {
    await db.delete(schema.agentMessages);
    await db.delete(schema.dailyEvents);
    await db.insert(schema.agentMessages).values({ title: "Daily", body: "digest", type: "digest" });
    await db.insert(schema.dailyEvents).values({ kind: "meeting", title: "Standup", startTime: new Date().toISOString(), data: {} });
    await db.insert(schema.dailyEvents).values({ kind: "task", title: "Fix bug", startTime: new Date().toISOString(), data: {} });

    const today = await app.inject({ method: "GET", url: `${base}/today` });
    expect(today.statusCode, "today").toBe(200);
    const tb = today.json() as { messages: { title: string }[]; meetings: { title: string }[]; tasks: { title: string }[] };
    expect(tb.messages.some((m) => m.title === "Daily")).toBe(true);
    expect(tb.meetings.some((m) => m.title === "Standup")).toBe(true);
    expect(tb.tasks.some((t) => t.title === "Fix bug")).toBe(true);

    const week = await app.inject({ method: "GET", url: `${base}/week` });
    expect(week.statusCode, "week").toBe(200);
    const wb = week.json() as { tasks: { title: string }[] };
    expect(wb.tasks.some((t) => t.title === "Fix bug")).toBe(true);
  });
});

describe.skipIf(!HAS_NATS || !HAS_DB)("agent — real NATS event pipeline", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    await db.delete(schema.agentMessages);
    await db.delete(schema.processedEvents);
    await db.delete(schema.dailyEvents);
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => { await app?.close(); });

  it("publishing tasks.status_changed creates a suggestion message via trigger evaluation", async () => {
    const deadline = new Date(Date.now() + 2 * 3_600_000).toISOString(); // 2h out → deadline_soon
    await EventBus.get().publish("pmos.tasks.tasks.status_changed", {
      taskId: "task-1",
      oldStatus: "todo",
      newStatus: "in_progress",
      task: { id: "task-1", title: "Сдать отчёт", deadline, assigneeId: null },
    }, { correlationId: "itest-1" });

    // JetStream consumer is async; give it a couple of redelivery-tolerant seconds.
    let rows: { title: string; type: string; source: string | null }[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 250));
      rows = await db.select({ title: schema.agentMessages.title, type: schema.agentMessages.type, source: schema.agentMessages.source })
        .from(schema.agentMessages);
      if (rows.length > 0) break;
    }
    expect(rows.length, "message rows").toBeGreaterThan(0);
    expect(rows.some((r) => r.title.includes("Сдать отчёт"))).toBe(true);
    expect(rows.some((r) => r.source === "task_no_assignee")).toBe(true);
  });

  it("publishing projects.projects.created with a goal creates a project_plan message", async () => {
    await db.delete(schema.agentMessages);
    await EventBus.get().publish("pmos.projects.projects.created", {
      id: "proj-1",
      name: "Запуск",
      goal: "Запустить продукт к декабрю",
    }, { correlationId: "itest-plan" });

    let rows: { title: string; type: string; source: string | null }[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 250));
      rows = await db.select({ title: schema.agentMessages.title, type: schema.agentMessages.type, source: schema.agentMessages.source })
        .from(schema.agentMessages);
      if (rows.some((r) => r.source === "project_plan")) break;
    }
    expect(rows.some((r) => r.source === "project_plan")).toBe(true);
    const plan = rows.find((r) => r.source === "project_plan");
    expect(plan?.type).toBe("trigger");
    expect(plan?.title).toBe("План проекта «Запуск»");
  });

  it("publishing calendar.meetings.updated with a past endTime creates a meeting_ended message", async () => {
    await db.delete(schema.agentMessages);
    await EventBus.get().publish("pmos.calendar.meetings.updated", {
      meetingId: "meet-1",
      title: "Планёрка",
      endTime: new Date(Date.now() - 3_600_000).toISOString(),
    }, { correlationId: "itest-meet" });

    let rows: { title: string; type: string; source: string | null }[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 250));
      rows = await db.select({ title: schema.agentMessages.title, type: schema.agentMessages.type, source: schema.agentMessages.source })
        .from(schema.agentMessages);
      if (rows.some((r) => r.source === "meeting_ended")) break;
    }
    expect(rows.some((r) => r.source === "meeting_ended")).toBe(true);
    const msg = rows.find((r) => r.source === "meeting_ended");
    expect(msg?.type).toBe("suggestion");
    expect(msg?.title).toContain("Создать заметку по встрече «Планёрка»");
  });
});
