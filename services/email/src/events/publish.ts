import { EventBus } from "@pmos/event-bus";

// Publish helpers for email. Subjects: pmos.email.<event> (ADR-007 §3).
export async function publishemailEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.email." + type, data, { correlationId });
}
