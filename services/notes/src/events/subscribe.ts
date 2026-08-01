import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope, NoteTitleGeneratedData } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { notes, processedEvents } from "../db/schema.js";
import { logger } from "../lib/errors.js";

export interface EventPublisher {
  publish<T>(type: string, data: T, opts?: { correlationId?: string; version?: number }): Promise<unknown>;
}

/**
 * Handle pmos.notes.title_generated (published by ai-gateway, SAGA §1): fill in
 * the note's title (and tag if present) when it is still the default/empty one.
 * Publish nothing further — the notes CRUD emit path is NOT used here to avoid
 * an update loop.
 * Idempotency: the event id is claimed in processed_events via
 * INSERT ... ON CONFLICT DO NOTHING, so at-least-once redeliveries are skipped.
 */
export async function handleNoteTitleGenerated(
  env: EventEnvelope<NoteTitleGeneratedData>,
  bus: EventPublisher = EventBus.get(),
): Promise<void> {
  const { noteId, title, tag } = env.data;

  const [row] = await db.select({ id: notes.id, title: notes.title }).from(notes)
    .where(eq(notes.id, noteId)).limit(1);
  if (!row) {
    logger.info({ noteId, eventId: env.id }, "title_generated: note not found — ignoring");
    return;
  }
  if (row.title.trim().length > 0) return; // user already titled it — don't overwrite

  const claimed = await db.insert(processedEvents)
    .values({ eventId: env.id })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  if (claimed.length === 0) return; // already processed

  await db.update(notes)
    .set({ title, ...(tag ? { tags: [tag] } : {}), updatedAt: new Date().toISOString() })
    .where(eq(notes.id, noteId));
}

export async function registerSubscribers(bus: EventBus): Promise<void> {
  await bus.subscribe<NoteTitleGeneratedData>("pmos.notes.title_generated", handleNoteTitleGenerated, { durable: "notes-ai-title" });
  logger.info({ service: "notes" }, "notes subscribers registered");
}
