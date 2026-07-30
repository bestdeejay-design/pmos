import { EventBus } from "@pmos/event-bus";

// Publish helpers for calendar. Subjects: pmos.calendar.<event> (ADR-007 §3).
export async function publishcalendarEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.calendar." + type, data, { correlationId });
}
