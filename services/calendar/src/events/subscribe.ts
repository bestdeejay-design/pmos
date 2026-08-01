import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { meetings, processedEvents } from "../db/schema.js";
import { logger } from "../lib/errors.js";

export interface EventPublisher {
  publish<T>(type: string, data: T, opts?: { correlationId?: string; version?: number }): Promise<unknown>;
}

// Wire format of pmos.external-calendars.external_events.created (contracts/asyncapi/events.yaml
// → ExternalEventCreatedData). externalEventId is the UUID of the external_events row.
export interface ExternalEventCreatedData {
  externalCalendarId: string;
  externalEventId: string;
  summary: string;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  recurrenceRule?: string | null;
  location?: string | null;
  correlationId?: string;
}

/**
 * Saga 4 (docs/SAGA.md §4): consume pmos.external-calendars.external_events.created and
 * merge the external event into a local `meetings` row linked via linked_external_event_id.
 * Idempotent: the event id is claimed in processed_events (INSERT ... ON CONFLICT DO NOTHING)
 * and a second guard checks meetings.linkedExternalEventId, so at-least-once redeliveries
 * and repeated syncs never duplicate a meeting. Nothing is published back — calendar CRUD
 * emits pmos.calendar.meetings.created only via its own routes.
 */
export async function handleExternalEventCreated(
  env: EventEnvelope<ExternalEventCreatedData>,
  _bus: EventPublisher = EventBus.get(),
): Promise<void> {
  const data = env.data;

  const claimed = await db.insert(processedEvents)
    .values({ eventId: env.id })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  if (claimed.length === 0) {
    logger.info({ eventId: env.id }, "external_events.created already processed — skip");
    return;
  }

  const [linked] = await db.select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.linkedExternalEventId, data.externalEventId))
    .limit(1);
  if (linked) {
    logger.info(
      { eventId: env.id, externalEventId: data.externalEventId, meetingId: linked.id },
      "meeting already linked to this external event — skip",
    );
    return;
  }

  if (!data.startTime || !data.endTime) {
    logger.warn({ eventId: env.id, externalEventId: data.externalEventId }, "external event missing startTime/endTime — skip");
    return;
  }

  await db.insert(meetings).values({
    title: data.summary,
    description: data.description ?? null,
    startTime: data.startTime,
    endTime: data.endTime,
    location: data.location ?? null,
    recurrence: data.recurrenceRule ?? null,
    linkedExternalEventId: data.externalEventId,
  });
  logger.info({ eventId: env.id, externalEventId: data.externalEventId }, "meeting created from external event");
}

// Guard: index.ts main() also registers subscribers after buildApp(); without this flag the
// same process would bind twice to the durable consumer (duplicate in-process queue member).
let registered = false;

export async function registerSubscribers(bus: EventBus): Promise<void> {
  if (registered) return;
  await bus.subscribe<ExternalEventCreatedData>(
    "pmos.external-calendars.external_events.created",
    handleExternalEventCreated,
    { durable: "calendar-sync-external-events", queue: "calendar-sync-external-events" },
  );
  registered = true;
  logger.info({ service: "calendar" }, "calendar subscribers registered");
}
