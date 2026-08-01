import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope, NoteCreatedData, NoteTitleGeneratedData } from "@pmos/shared";
import { db } from "../db/connection.js";
import { processedEvents } from "../db/schema.js";
import { logger } from "../lib/errors.js";
import { generateTitle } from "../lib/llm.js";

export interface EventPublisher {
  publish<T>(type: string, data: T, opts?: { correlationId?: string; version?: number }): Promise<unknown>;
}

/**
 * Wire payload of pmos.notes.notes.created: notes routes emit the Drizzle row
 * (camelCase, `id`), while the SAGA/events.yaml canonical format uses `noteId`.
 * Accept both — `id` wins is irrelevant because only one is ever present.
 */
interface NoteCreatedWireData extends Partial<NoteCreatedData> {
  id?: string;
}

/**
 * Handle a freshly-created note: if the title is already set, publish nothing;
 * otherwise generate a title via the LLM (Ollama) and publish
 * pmos.notes.title_generated. NEVER throws — LLM failures degrade to a heuristic
 * title (first line of the body, 60 chars).
 * Idempotency: the event id is claimed in processed_events via
 * INSERT ... ON CONFLICT DO NOTHING, so at-least-once redeliveries are skipped.
 */
export async function handleNoteCreated(
  env: EventEnvelope<NoteCreatedWireData>,
  bus: EventPublisher = EventBus.get(),
): Promise<void> {
  const noteId = env.data.noteId ?? env.data.id;
  const title = env.data.title ?? "";
  const bodyMd = env.data.bodyMd ?? "";

  if (!noteId) return; // malformed event — nothing to attach a title to
  if (title.trim().length > 0) return; // title already set — nothing to do

  const claimed = await db.insert(processedEvents)
    .values({ eventId: env.id })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  if (claimed.length === 0) return; // already processed

  const { title: generatedTitle, tag } = await generateTitle(bodyMd);
  await bus.publish("pmos.notes.title_generated", {
    noteId,
    title: generatedTitle,
    tag: tag ?? undefined,
  } satisfies NoteTitleGeneratedData, { correlationId: env.correlationId });
}

export async function registerSubscribers(bus: EventBus): Promise<void> {
  // Both naming conventions: the actual wire event published by notes routes is
  // pmos.notes.notes.created; events.yaml canonical channel is pmos.notes.created.
  await bus.subscribe<NoteCreatedWireData>("pmos.notes.notes.created", handleNoteCreated, { durable: "ai-gateway-title-gen" });
  await bus.subscribe<NoteCreatedWireData>("pmos.notes.created", handleNoteCreated, { durable: "ai-gateway-title-gen-canonical" });
  logger.info({ service: "ai-gateway" }, "note title subscribers registered");
}
