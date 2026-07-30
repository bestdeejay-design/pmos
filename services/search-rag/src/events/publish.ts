import { EventBus } from "@pmos/event-bus";

// Publish helpers for search-rag. Subjects: pmos.search-rag.<event> (ADR-007 §3).
export async function publishsearchragEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.search-rag." + type, data, { correlationId });
}
