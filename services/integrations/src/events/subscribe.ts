import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { processedEvents } from "../db/schema.js";
import { scheduleWebhookDeliveries } from "../lib/webhook-delivery.js";
import { logger } from "../lib/errors.js";

/**
 * Inbound event handlers for integrations: the webhook delivery engine.
 *
 * Subject convention (verified against contracts/asyncapi/events.yaml):
 *  - Wire subjects actually published by the scaffold CRUD (x-implemented-wire-events)
 *    are nested: pmos.notes.notes.created, pmos.calendar.meetings.created, ...
 *  - The catalog channel names (pmos.notes.created, pmos.meetings.*, ...) are listed
 *    too for forward-compat: subscriptions are cheap and never fire unless a publisher
 *    starts using them.
 *
 * NATS ack is immediate: the handler only persists idempotency + enqueues delivery
 * rows and arms timers — HTTP delivery happens asynchronously in webhook-delivery.ts.
 */

const WIRE_SUBJECTS = [
  "pmos.notes.notes.*",
  "pmos.tasks.tasks.*",
  "pmos.calendar.meetings.*",
  "pmos.files.files.*",
  "pmos.projects.projects.*",
  "pmos.agent.agent-messages.*",
];

const CATALOG_SUBJECTS = [
  "pmos.notes.created",
  "pmos.notes.updated",
  "pmos.notes.deleted",
  "pmos.tasks.created",
  "pmos.tasks.updated",
  "pmos.tasks.deleted",
  "pmos.meetings.created",
  "pmos.meetings.updated",
  "pmos.meetings.deleted",
  "pmos.files.created",
  "pmos.files.updated",
  "pmos.files.deleted",
  "pmos.projects.created",
  "pmos.projects.updated",
  "pmos.projects.deleted",
  "pmos.agent.message_created",
];

const SUBJECTS = [...WIRE_SUBJECTS, ...CATALOG_SUBJECTS];

async function handleEvent(env: EventEnvelope<Record<string, unknown>>): Promise<void> {
  // Idempotency (SAGA.md / events.yaml): at-least-once delivery must not double-fire.
  const seen = await db.select({ id: processedEvents.id }).from(processedEvents)
    .where(eq(processedEvents.eventId, env.id)).limit(1);
  if (seen.length > 0) return;

  // Enqueue deliveries (DB inserts + timer arming only — no HTTP, no NATS blocking).
  await scheduleWebhookDeliveries(env);

  await db.insert(processedEvents).values({ eventId: env.id, eventType: env.type })
    .onConflictDoNothing();
}

// Register inbound event handlers for integrations.
// Pattern: handler must be idempotent — check processed_events before mutating (SAGA.md).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  for (const subject of SUBJECTS) {
    await bus.subscribe(subject, handleEvent);
  }
  logger.info({ service: "integrations", subjects: SUBJECTS.length }, "webhook subscribers registered");
}
