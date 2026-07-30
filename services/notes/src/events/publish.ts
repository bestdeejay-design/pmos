import { EventBus } from "@pmos/event-bus";

// Publish helpers for notes. Subjects: pmos.notes.<event> (ADR-007 §3).
export async function publishnotesEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.notes." + type, data, { correlationId });
}
