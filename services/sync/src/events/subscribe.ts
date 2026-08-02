import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { logger } from "../lib/errors.js";
import { writeNoteExport, deleteNoteExport } from "../lib/exporter.js";

// Files auto-exported from a note change. The writer is idempotent (keyed by note id),
// so duplicate at-least-once delivery safely re-writes the same bytes.
export async function handleNoteEvent(env: EventEnvelope<Record<string, unknown>>): Promise<void> {
  const action = String(env.type ?? "").split(".").pop();
  const data = (env.data ?? {}) as Record<string, unknown>;
  const noteId = data.id ? String(data.id) : undefined;
  if (!noteId) return;

  if (action === "deleted" || data.isArchived === true) {
    await deleteNoteExport(noteId);
  } else {
    await writeNoteExport({
      id: noteId,
      title: toString(data.title),
      bodyMd: toString(data.bodyMd),
      tags: toStringArray(data.tags),
      createdAt: toString(data.createdAt),
      isArchived: data.isArchived === true ? true : undefined,
    });
  }
}

const SUBJECTS = ["pmos.notes.notes.*", "pmos.notes.*"];

export async function registerSubscribers(bus: EventBus): Promise<void> {
  for (const subject of SUBJECTS) {
    await bus.subscribe(subject, handleNoteEvent);
  }
  logger.info({ service: "sync", subjects: SUBJECTS.length }, "auto-export subscribers registered");
}

function toString(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

function toStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)) : undefined;
}
