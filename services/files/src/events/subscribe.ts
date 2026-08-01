import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope, FileUploadedData } from "@pmos/shared";
import { db } from "../db/connection.js";
import { processedEvents } from "../db/schema.js";
import { readStoredFile } from "../lib/storage.js";
import { extractText } from "../lib/text-extract.js";
import { logger } from "../lib/errors.js";

/** Cap for reading the stored file during extraction (~1MB). */
const MAX_READ = 1024 * 1024;

export interface EventPublisher {
  publish<T>(type: string, data: T, opts?: { correlationId?: string; version?: number }): Promise<unknown>;
}

/**
 * Self-subscription for `pmos.files.uploaded`: read the file from disk (≤1MB),
 * extract text by MIME type and publish `pmos.files.text_extracted` for search-rag.
 * Idempotency: the event id is claimed in processed_events via
 * INSERT ... ON CONFLICT DO NOTHING, so at-least-once redeliveries are skipped.
 */
export async function handleFileUploaded(
  env: EventEnvelope<FileUploadedData>,
  bus: EventPublisher = EventBus.get(),
): Promise<void> {
  const { fileId, storagePath, mimeType } = env.data;
  const claimed = await db.insert(processedEvents)
    .values({ eventId: env.id })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  if (claimed.length === 0) return; // already processed

  let extractedText = "";
  try {
    const buffer = await readStoredFile(storagePath, MAX_READ);
    extractedText = await extractText(mimeType, buffer);
  } catch (e) {
    logger.error({ err: e, fileId, eventId: env.id }, "text extraction failed — publishing empty text");
  }

  await bus.publish("pmos.files.text_extracted", { fileId, extractedText, mimeType }, { correlationId: env.correlationId });
}

export async function registerSubscribers(bus: EventBus): Promise<void> {
  await bus.subscribe<FileUploadedData>("pmos.files.uploaded", handleFileUploaded, { durable: "files-text-extract" });
  logger.info({ service: "files" }, "files subscribers registered");
}
