import { describe, it, expect } from "vitest";
import {
  evaluateTaskTriggers,
  meetingEndedDue,
  buildProjectPlanBody,
} from "../src/lib/triggers.js";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

describe("evaluateTaskTriggers — deadline_soon", () => {
  const ctx = { assigneeId: "u1" }; // isolate deadline_soon from task_no_assignee

  it("fires when the deadline is within 24h", () => {
    const deadline = new Date(NOW + 2 * 3_600_000).toISOString(); // 2h out
    const msgs = evaluateTaskTriggers({ title: "Сдать отчёт", deadline, newStatus: "in_progress", now: NOW, ...ctx });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe("trigger");
    expect(msgs[0]!.source).toBe("deadline_soon");
    expect(msgs[0]!.body).toContain("через 2 ч");
  });

  it("rounds to at least 1 hour", () => {
    const deadline = new Date(NOW + 10 * 60_000).toISOString(); // 10 min out
    const msgs = evaluateTaskTriggers({ title: "T", deadline, newStatus: "todo", now: NOW, ...ctx });
    expect(msgs[0]!.body).toContain("через 1 ч");
  });

  it("does not fire when the deadline is more than 24h away", () => {
    const deadline = new Date(NOW + 48 * 3_600_000).toISOString();
    const msgs = evaluateTaskTriggers({ title: "T", deadline, newStatus: "todo", now: NOW, ...ctx });
    expect(msgs.some((m) => m.source === "deadline_soon")).toBe(false);
  });

  it("does not fire when the deadline has already passed", () => {
    const deadline = new Date(NOW - 3_600_000).toISOString();
    const msgs = evaluateTaskTriggers({ title: "T", deadline, newStatus: "todo", now: NOW, ...ctx });
    expect(msgs.some((m) => m.source === "deadline_soon")).toBe(false);
  });

  it("does not fire when the task is done", () => {
    const deadline = new Date(NOW + 2 * 3_600_000).toISOString();
    const msgs = evaluateTaskTriggers({ title: "T", deadline, newStatus: "done", now: NOW, ...ctx });
    expect(msgs.some((m) => m.source === "deadline_soon")).toBe(false);
  });
});

describe("evaluateTaskTriggers — task_no_assignee", () => {
  it("fires when neither assigneeId nor assignee is set", () => {
    const msgs = evaluateTaskTriggers({ title: "T", assigneeId: null, assignee: null, now: NOW });
    expect(msgs.some((m) => m.source === "task_no_assignee")).toBe(true);
    expect(msgs.find((m) => m.source === "task_no_assignee")!.type).toBe("suggestion");
  });

  it("does not fire when assigneeId is set", () => {
    const msgs = evaluateTaskTriggers({ title: "T", assigneeId: "u1", now: NOW });
    expect(msgs.some((m) => m.source === "task_no_assignee")).toBe(false);
  });

  it("does not fire when legacy assignee is set", () => {
    const msgs = evaluateTaskTriggers({ title: "T", assignee: "u1", now: NOW });
    expect(msgs.some((m) => m.source === "task_no_assignee")).toBe(false);
  });
});

describe("meetingEndedDue", () => {
  it("is true when the end time has passed", () => {
    expect(meetingEndedDue(new Date(NOW - 1).toISOString(), NOW)).toBe(true);
  });

  it("is false when the end time is in the future", () => {
    expect(meetingEndedDue(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(false);
  });

  it("is false when the end time is missing or invalid", () => {
    expect(meetingEndedDue(undefined, NOW)).toBe(false);
    expect(meetingEndedDue(null, NOW)).toBe(false);
    expect(meetingEndedDue("not-a-date", NOW)).toBe(false);
  });
});

describe("buildProjectPlanBody", () => {
  it("produces a deterministic Russian outline from the goal", () => {
    const body = buildProjectPlanBody("Запустить продукт");
    expect(body).toContain("План по цели: Запустить продукт");
    expect(body).toContain("1)");
    expect(body).toContain("2)");
    expect(body).toContain("3)");
    expect(body).toContain("4)");
    expect(body).toContain("5)");
  });

  it("is deterministic for the same goal", () => {
    expect(buildProjectPlanBody("X")).toBe(buildProjectPlanBody("X"));
  });
});