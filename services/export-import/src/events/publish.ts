import { EventBus } from "@pmos/event-bus";

// Publish helpers for export-import. Subjects: pmos.export-import.<event> (ADR-007 §3).
export async function publishexportimportEvent(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.export-import." + type, data, { correlationId });
}
