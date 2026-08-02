import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { exportStore, processedEvents } from "../db/schema.js";
import { logger } from "../lib/errors.js";

/**
 * Inbound event handlers for export-import: feed the export_store read model.
 *
 * Subject convention (contracts/asyncapi/events.yaml): the scaffold actually
 * publishes nested wire subjects (pmos.notes.notes.created,
 * pmos.calendar.meetings.created, ... — see x-implemented-wire-events); the
 * catalog channel names (pmos.notes.created, pmos.meetings.*, ...) are subscribed
 * too for forward-compat. entity_type is derived from the envelope type.
 */

const SUBJECTS = [
  "pmos.notes.notes.*",
  "pmos.tasks.tasks.*",
  "pmos.calendar.meetings.*",
  "pmos.files.files.*",
  "pmos.projects.projects.*",
  "pmos.profiles.profiles.*",
  "pmos.settings.settings.*",
  "pmos.notes.*",
  "pmos.tasks.*",
  "pmos.meetings.*",
  "pmos.files.*",
  "pmos.projects.*",
  "pmos.profiles.*",
  "pmos.settings.changed",
];

/** "pmos.notes.notes.created" -> "notes"; "pmos.calendar.meetings.created" -> "meetings". */
function entityTypeOf(type: string): string | null {
  const parts = String(type ?? "").replace(/^pmos\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] === "calendar") return "meetings";
  return parts.length >= 3 ? (parts[1] ?? "") : (parts[0] ?? "");
}

/** entity_id = data.id or data.<x>Id (whatever identifier the event carries). */
function entityIdOf(data: unknown): string {
  if (typeof data !== "object" || data === null) return String(data ?? "");
  const obj = data as Record<string, unknown>;
  for (const key of ["id", "noteId", "taskId", "meetingId", "projectId", "fileId", "profileId", "settingId"]) {
    const v = obj[key];
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
}

export async function handleEvent(env: EventEnvelope<Record<string, unknown>>): Promise<void> {
  const seen = await db.select({ id: processedEvents.id }).from(processedEvents)
    .where(eq(processedEvents.eventId, env.id)).limit(1);
  if (seen.length > 0) return;

  const entityType = entityTypeOf(env.type);
  const entityId = entityIdOf(env.data);
  if (!entityType || !entityId) return;

  const now = new Date().toISOString();
  await db.insert(exportStore).values({ entityType, entityId, payload: env.data, createdAt: now })
    .onConflictDoUpdate({
      target: [exportStore.entityType, exportStore.entityId],
      set: { payload: env.data, updatedAt: now },
    });

  await db.insert(processedEvents).values({ eventId: env.id, eventType: env.type })
    .onConflictDoNothing();
}

// Register inbound event handlers for export-import.
// Pattern: handler must be idempotent — check processed_events before mutating (SAGA.md).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  for (const subject of SUBJECTS) {
    await bus.subscribe(subject, handleEvent);
  }
  logger.info({ service: "export-import", subjects: SUBJECTS.length }, "export-store subscribers registered");
}
