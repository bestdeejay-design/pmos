import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { EventBus } from "@pmos/event-bus";
import { agentRoutes } from "./routes/index.js";

export async function buildApp() {
  EventBus.init({ serviceName: "agent", url: process.env.NATS_URL });
  // Best-effort: connect + ensure stream + register inbound subscribers.
  // Skipped if NATS is down; a dead bus never blocks HTTP startup.
  await EventBus.get().connect().then(async () => {
    await EventBus.get().ensureStream();
    await import("./events/subscribe.js")
      .then((m) => m.registerSubscribers(EventBus.get()))
      .catch((e) => console.error("[event] registerSubscribers failed:", e));
  }).catch(() => {});
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(agentRoutes, { prefix: "/api/agent/v1" });

  app.setErrorHandler(errorHandler);
  return app;
}
