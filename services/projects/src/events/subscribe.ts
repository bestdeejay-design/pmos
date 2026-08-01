import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { logger } from "../lib/errors.js";

type Data = Record<string, unknown>;

function asStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

// ───────────────────────── idempotency (SAGA.md) ─────────────────────────

async function isProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select({ eventId: schema.processedEvents.eventId })
    .from(schema.processedEvents)
    .where(eq(schema.processedEvents.eventId, eventId))
    .limit(1);
  return rows.length > 0;
}

async function markProcessed(eventId: string): Promise<void> {
  await db.insert(schema.processedEvents).values({ eventId }).onConflictDoNothing();
}

async function runIdempotent(env: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (await isProcessed(env.id)) return;
  await fn();
  await markProcessed(env.id);
}

// ───────────────────────── index helpers (exported for tests) ─────────────────────────

export interface UpsertProjectItemParams {
  projectId: string;
  entityType: string;
  entityId: string;
  title?: string | null;
  startDate?: string | null;
  status?: string | null;
  payload?: unknown;
}

export async function upsertProjectItem(p: UpsertProjectItemParams): Promise<void> {
  const payload = (p.payload ?? {}) as Record<string, unknown>;
  await db
    .insert(schema.projectItems)
    .values({
      projectId: p.projectId,
      entityType: p.entityType,
      entityId: p.entityId,
      title: p.title ?? null,
      startDate: p.startDate ?? null,
      status: p.status ?? null,
      payload,
    })
    .onConflictDoUpdate({
      target: [schema.projectItems.projectId, schema.projectItems.entityType, schema.projectItems.entityId],
      set: {
        title: p.title ?? null,
        startDate: p.startDate ?? null,
        status: p.status ?? null,
        payload,
      },
    });
}

export async function removeProjectItem(entityType: string, entityId: string): Promise<void> {
  await db
    .delete(schema.projectItems)
    .where(and(eq(schema.projectItems.entityType, entityType), eq(schema.projectItems.entityId, entityId)));
}

// ───────────────────────── event handlers ─────────────────────────

async function onNoteEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    const projectId = asStr(d.linkedProjectId);
    if (!projectId || !d.id) return; // store only if linked to a project
    await upsertProjectItem({
      projectId,
      entityType: "note",
      entityId: String(d.id),
      title: asStr(d.title),
      payload: d,
    });
  });
}

async function onTaskEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    const projectId = asStr(d.projectId);
    if (!projectId || !d.id) return; // store only if linked to a project
    await upsertProjectItem({
      projectId,
      entityType: "task",
      entityId: String(d.id),
      title: asStr(d.title),
      startDate: asStr(d.deadline) ?? asStr(d.dueDate),
      status: asStr(d.status),
      payload: d,
    });
  });
}

async function onMeetingEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    const projectId = asStr(d.linkedProjectId);
    if (!projectId || !d.id) return; // store only if linked to a project
    await upsertProjectItem({
      projectId,
      entityType: "meeting",
      entityId: String(d.id),
      title: asStr(d.title),
      startDate: asStr(d.startTime),
      status: null,
      payload: d,
    });
  });
}

async function onFileEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    const projectId = d.ownerType === "project" ? asStr(d.ownerId) : null;
    if (!projectId || !d.id) return; // store only if owned by a project
    await upsertProjectItem({
      projectId,
      entityType: "file",
      entityId: String(d.id),
      title: asStr(d.filename),
      status: null,
      payload: d,
    });
  });
}

function deletedHandler(entityType: string) {
  return async (env: EventEnvelope): Promise<void> => {
    await runIdempotent(env, async () => {
      const d = env.data as Data;
      if (!d.id) return;
      await removeProjectItem(entityType, String(d.id));
    });
  };
}

// ───────────────────────── registration ─────────────────────────

// Register inbound event handlers for projects (SAGA read model).
// Subjects cover BOTH the canonical catalog form (contracts/asyncapi/events.yaml)
// and the actual wire subjects emitted by CRUD routes (x-implemented-wire-events).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  for (const s of ["pmos.notes.notes.created", "pmos.notes.created", "pmos.notes.notes.updated", "pmos.notes.updated"]) {
    await bus.subscribe(s, onNoteEvent);
  }
  for (const s of ["pmos.tasks.tasks.created", "pmos.tasks.created", "pmos.tasks.tasks.updated", "pmos.tasks.updated"]) {
    await bus.subscribe(s, onTaskEvent);
  }
  for (const s of ["pmos.calendar.meetings.created", "pmos.meetings.created", "pmos.calendar.meetings.updated", "pmos.meetings.updated"]) {
    await bus.subscribe(s, onMeetingEvent);
  }
  for (const s of ["pmos.files.files.created", "pmos.files.uploaded", "pmos.files.files.updated", "pmos.files.updated"]) {
    await bus.subscribe(s, onFileEvent);
  }

  await bus.subscribe("pmos.notes.notes.deleted", deletedHandler("note"));
  await bus.subscribe("pmos.notes.deleted", deletedHandler("note"));
  await bus.subscribe("pmos.tasks.tasks.deleted", deletedHandler("task"));
  await bus.subscribe("pmos.tasks.deleted", deletedHandler("task"));
  await bus.subscribe("pmos.calendar.meetings.deleted", deletedHandler("meeting"));
  await bus.subscribe("pmos.meetings.deleted", deletedHandler("meeting"));
  await bus.subscribe("pmos.files.files.deleted", deletedHandler("file"));
  await bus.subscribe("pmos.files.deleted", deletedHandler("file"));

  logger.info({ service: "projects" }, "subscribers registered");
}
