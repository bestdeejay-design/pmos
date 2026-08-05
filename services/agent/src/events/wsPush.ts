import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { wsHub } from "../plugins/ws.js";

/** Subjects whose events are pushed live to connected browsers. */
const PUSH_SUBJECTS = [
  "pmos.agent.message_created",
  "pmos.calendar.meetings.updated",
  "pmos.calendar.meetings.reminder",
  "pmos.tasks.tasks.updated",
] as const;

/**
 * Subscribe to the live-push subjects and broadcast each envelope to every
 * connected WebSocket client. Best-effort: a dead NATS must never break HTTP.
 */
export async function registerWsPush(bus: EventBus): Promise<void> {
  for (const subject of PUSH_SUBJECTS) {
    await bus.subscribe(subject, async (env: EventEnvelope) => {
      wsHub.broadcast(env.type, env.data);
    });
  }
}