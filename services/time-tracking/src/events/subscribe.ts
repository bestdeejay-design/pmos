import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { logger } from "../lib/errors.js";

type Data = Record<string, unknown>;

function asStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

// ───────────────────────── task→project cache (task_projects) ─────────────────────────
// Handlers below are naturally idempotent: task/project events are upserted
// (ON CONFLICT task_id DO UPDATE) or deleted, so a re-delivered envelope just
// replays the same final state. processed_events is NOT needed here (SAGA.md).

export interface UpsertTaskProjectParams {
  taskId: string;
  taskTitle?: string | null;
  projectId?: string | null;
}

export async function upsertTaskProject(p: UpsertTaskProjectParams): Promise<void> {
  await db
    .insert(schema.taskProjects)
    .values({
      taskId: p.taskId,
      taskTitle: p.taskTitle ?? null,
      projectId: p.projectId ?? null,
      projectName: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.taskProjects.taskId,
      set: {
        taskTitle: p.taskTitle ?? null,
        projectId: p.projectId ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function deleteTaskProject(taskId: string): Promise<void> {
  await db.delete(schema.taskProjects).where(eq(schema.taskProjects.taskId, taskId));
}

export async function setTaskProjectName(projectId: string, projectName: string | null): Promise<void> {
  await db
    .update(schema.taskProjects)
    .set({ projectName, updatedAt: new Date() })
    .where(eq(schema.taskProjects.projectId, projectId));
}

// ───────────────────────── event handlers ─────────────────────────

async function onTaskUpsert(env: EventEnvelope): Promise<void> {
  const d = env.data as Data;
  const taskId = asStr(d.id);
  if (!taskId) return;
  await upsertTaskProject({ taskId, taskTitle: asStr(d.title), projectId: asStr(d.projectId) });
}

async function onTaskDeleted(env: EventEnvelope): Promise<void> {
  const d = env.data as Data;
  const taskId = asStr(d.id);
  if (!taskId) return;
  await deleteTaskProject(taskId);
}

async function onProjectUpsert(env: EventEnvelope): Promise<void> {
  const d = env.data as Data;
  const projectId = asStr(d.id);
  if (!projectId) return;
  await setTaskProjectName(projectId, asStr(d.name));
}

async function onProjectDeleted(env: EventEnvelope): Promise<void> {
  const d = env.data as Data;
  const projectId = asStr(d.id);
  if (!projectId) return;
  await setTaskProjectName(projectId, null);
}

// ───────────────────────── registration ─────────────────────────

// Register inbound event handlers for time-tracking (task_projects cache).
// Subjects cover BOTH the canonical catalog form (contracts/asyncapi/events.yaml)
// and the actual wire subjects emitted by CRUD routes (x-implemented-wire-events).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  for (const s of ["pmos.tasks.tasks.created", "pmos.tasks.created", "pmos.tasks.tasks.updated", "pmos.tasks.updated"]) {
    await bus.subscribe(s, onTaskUpsert);
  }
  for (const s of ["pmos.tasks.tasks.deleted", "pmos.tasks.deleted"]) {
    await bus.subscribe(s, onTaskDeleted);
  }
  for (const s of ["pmos.projects.projects.created", "pmos.projects.created", "pmos.projects.projects.updated", "pmos.projects.updated"]) {
    await bus.subscribe(s, onProjectUpsert);
  }
  for (const s of ["pmos.projects.projects.deleted", "pmos.projects.deleted"]) {
    await bus.subscribe(s, onProjectDeleted);
  }

  logger.info({ service: "time-tracking" }, "subscribers registered (task_projects cache)");
}
