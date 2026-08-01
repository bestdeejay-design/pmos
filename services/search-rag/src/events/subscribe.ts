import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { embed } from "../lib/embed.js";
import { logger } from "../lib/errors.js";

type Data = Record<string, unknown>;

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

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

/** Run a handler once per event id — skip duplicates (at-least-once delivery). */
async function runIdempotent(env: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (await isProcessed(env.id)) return;
  await fn();
  await markProcessed(env.id);
}

// ───────────────────────── index helpers (exported for tests) ─────────────────────────

export interface UpsertEmbeddingParams {
  entityType: string;
  entityId: string;
  content: string;
  profileIds?: string[];
  metadata?: Record<string, unknown>;
}

export async function upsertEmbedding(p: UpsertEmbeddingParams): Promise<void> {
  const embedding = await embed(p.content);
  const metadata = p.metadata ?? {};
  await db
    .insert(schema.embeddings)
    .values({
      entityType: p.entityType,
      entityId: p.entityId,
      content: p.content,
      profileIds: p.profileIds ?? [],
      metadata,
      ...(embedding ? { embedding } : {}),
    })
    .onConflictDoUpdate({
      target: [schema.embeddings.entityType, schema.embeddings.entityId],
      set: {
        content: p.content,
        profileIds: p.profileIds ?? [],
        metadata,
        embedding: embedding ?? null,
      },
    });
}

export async function deleteEmbedding(entityType: string, entityId: string): Promise<void> {
  await db
    .delete(schema.embeddings)
    .where(and(eq(schema.embeddings.entityType, entityType), eq(schema.embeddings.entityId, entityId)));
}

// ───────────────────────── event handlers ─────────────────────────

async function onNoteEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    if (!d.id) return;
    await upsertEmbedding({
      entityType: "note",
      entityId: String(d.id),
      content: `${asStr(d.title) ?? ""} ${asStr(d.bodyMd) ?? ""}`.trim(),
      profileIds: asStrArray(d.profileIds),
      metadata: { tags: d.tags ?? [], projectId: asStr(d.linkedProjectId) },
    });
  });
}

async function onTaskEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    if (!d.id) return;
    await upsertEmbedding({
      entityType: "task",
      entityId: String(d.id),
      content: `${asStr(d.title) ?? ""} ${asStr(d.description) ?? ""}`.trim(),
      profileIds: asStrArray(d.profileIds),
      metadata: { tags: d.tags ?? [], projectId: asStr(d.projectId) },
    });
  });
}

async function onMeetingEvent(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    if (!d.id) return;
    await upsertEmbedding({
      entityType: "meeting",
      entityId: String(d.id),
      content: `${asStr(d.title) ?? ""} ${asStr(d.description) ?? ""}`.trim(),
      profileIds: asStrArray(d.profileIds),
      metadata: { projectId: asStr(d.linkedProjectId) },
    });
  });
}

async function onFileTextExtracted(env: EventEnvelope): Promise<void> {
  await runIdempotent(env, async () => {
    const d = env.data as Data;
    if (!d.id) return;
    await upsertEmbedding({
      entityType: "file",
      entityId: String(d.id),
      content: `${asStr(d.filename) ?? ""} ${asStr(d.extractedText) ?? ""}`.trim(),
      profileIds: [],
      metadata: { filename: asStr(d.filename), mimeType: asStr(d.mime) },
    });
  });
}

function deletedHandler(entityType: string) {
  return async (env: EventEnvelope): Promise<void> => {
    await runIdempotent(env, async () => {
      const d = env.data as Data;
      if (!d.id) return;
      await deleteEmbedding(entityType, String(d.id));
    });
  };
}

// ───────────────────────── registration ─────────────────────────

// Register inbound event handlers for search-rag (SAGA read model).
// Subjects cover BOTH the canonical catalog form (contracts/asyncapi/events.yaml:
// pmos.<svc>.<action>) and the actual wire subjects emitted by CRUD routes
// (pmos.<svc>.<resource>.<action>, see x-implemented-wire-events). Subscribe is
// harmless for subjects that never fire.
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
  for (const s of ["pmos.files.text_extracted", "pmos.files.files.updated", "pmos.files.updated"]) {
    await bus.subscribe(s, onFileTextExtracted);
  }

  await bus.subscribe("pmos.notes.notes.deleted", deletedHandler("note"));
  await bus.subscribe("pmos.notes.deleted", deletedHandler("note"));
  await bus.subscribe("pmos.tasks.tasks.deleted", deletedHandler("task"));
  await bus.subscribe("pmos.tasks.deleted", deletedHandler("task"));
  await bus.subscribe("pmos.calendar.meetings.deleted", deletedHandler("meeting"));
  await bus.subscribe("pmos.meetings.deleted", deletedHandler("meeting"));
  await bus.subscribe("pmos.files.files.deleted", deletedHandler("file"));
  await bus.subscribe("pmos.files.deleted", deletedHandler("file"));

  logger.info({ service: "search-rag" }, "subscribers registered");
}
