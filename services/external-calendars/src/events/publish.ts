import { EventBus } from "@pmos/event-bus";

// Publish helpers for external-calendars. Subjects: pmos.external-calendars.<event> (ADR-007 §3).
export async function publishexternalcalendarsEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.external-calendars." + type, data, { correlationId });
}
