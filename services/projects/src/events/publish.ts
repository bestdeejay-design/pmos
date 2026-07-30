import { EventBus } from "@pmos/event-bus";

// Publish helpers for projects. Subjects: pmos.projects.<event> (ADR-007 §3).
export async function publishprojectsEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.projects." + type, data, { correlationId });
}
