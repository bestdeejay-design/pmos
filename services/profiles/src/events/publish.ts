import { EventBus } from "@pmos/event-bus";

// Publish helpers for profiles. Subjects: pmos.profiles.<event> (ADR-007 §3).
export async function publishprofilesEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.profiles." + type, data, { correlationId });
}
