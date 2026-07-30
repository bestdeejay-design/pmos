import { EventBus } from "@pmos/event-bus";

// Publish helpers for time-tracking. Subjects: pmos.time-tracking.<event> (ADR-007 §3).
export async function publishtimetrackingEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.time-tracking." + type, data, { correlationId });
}
