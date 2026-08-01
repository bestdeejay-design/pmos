import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { EventBus } from "@pmos/event-bus";
import { export_importRoutes } from "./routes/index.js";
import { registerSubscribers } from "./events/subscribe.js";

export async function buildApp() {
  EventBus.init({ serviceName: "export-import", url: process.env.NATS_URL });
  // Best-effort: connect + ensure the JetStream stream exists. Skipped if NATS is down.
  await EventBus.get().connect().then(() => EventBus.get().ensureStream()).catch(() => {});
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(export_importRoutes, { prefix: "/api/export-import/v1" });

  app.setErrorHandler(errorHandler);

  // Inbound export-store subscribers — best-effort (no NATS -> no events).
  try {
    await registerSubscribers(EventBus.get());
  } catch (err) {
    console.error("[export-import] event subscribers unavailable:", err);
  }

  return app;
}
