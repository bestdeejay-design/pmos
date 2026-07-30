import { EventBus } from "@pmos/event-bus";
import { logger } from "../lib/errors.js";

// Register inbound event handlers for agent.
// Pattern: handler must be idempotent — check processed_events before mutating (SAGA.md).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  // TODO(svc-agent): bus.subscribe("pmos.profiles.updated", async (env) => { ... });
  logger.info({ service: "agent" }, "no subscribers registered yet");
}
