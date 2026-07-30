import { EventBus } from "@pmos/event-bus";

// Publish helpers for settings. Subjects: pmos.settings.<event> (ADR-007 §3).
export async function publishsettingsEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.settings." + type, data, { correlationId });
}
