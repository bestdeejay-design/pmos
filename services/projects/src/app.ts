import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { EventBus } from "@pmos/event-bus";
import { projectsRoutes } from "./routes/index.js";
import { registerSubscribers } from "./events/subscribe.js";

export async function buildApp() {
  EventBus.init({ serviceName: "projects", url: process.env.NATS_URL });
  // Best-effort: connect + ensure the JetStream stream exists. Skipped if NATS is down.
  await EventBus.get().connect().then(() => EventBus.get().ensureStream()).catch(() => {});
  // Best-effort: register inbound event subscribers (SAGA read model). Skipped if NATS is down.
  try {
    await registerSubscribers(EventBus.get());
  } catch (e) {
    console.error("[projects] registerSubscribers skipped:", e);
  }
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(projectsRoutes, { prefix: "/api/projects/v1" });

  app.setErrorHandler(errorHandler);
  return app;
}
