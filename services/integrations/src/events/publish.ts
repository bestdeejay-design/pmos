import { EventBus } from "@pmos/event-bus";

// Publish helpers for integrations. Subjects: pmos.integrations.<event> (ADR-007 §3).
export async function publishintegrationsEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.integrations." + type, data, { correlationId });
}
