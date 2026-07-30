import { EventBus } from "@pmos/event-bus";

// Publish helpers for sync. Subjects: pmos.sync.<event> (ADR-007 §3).
export async function publishsyncEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.sync." + type, data, { correlationId });
}
