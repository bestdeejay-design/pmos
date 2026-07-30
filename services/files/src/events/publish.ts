import { EventBus } from "@pmos/event-bus";

// Publish helpers for files. Subjects: pmos.files.<event> (ADR-007 §3).
export async function publishfilesEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.files." + type, data, { correlationId });
}
