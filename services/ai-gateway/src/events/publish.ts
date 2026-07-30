import { EventBus } from "@pmos/event-bus";

// Publish helpers for ai-gateway. Subjects: pmos.ai-gateway.<event> (ADR-007 §3).
export async function publishaigatewayEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.ai-gateway." + type, data, { correlationId });
}
