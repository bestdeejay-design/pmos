import { EventBus } from "@pmos/event-bus";

// Publish helpers for agent. Subjects: pmos.agent.<event> (ADR-007 §3).
export async function publishagentEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.agent." + type, data, { correlationId });
}
