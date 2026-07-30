import { EventBus } from "@pmos/event-bus";

// Publish helpers for tasks. Subjects: pmos.tasks.<event> (ADR-007 §3).
export async function publishtasksEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.tasks." + type, data, { correlationId });
}
