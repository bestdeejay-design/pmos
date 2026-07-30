import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { emailRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(emailRoutes, { prefix: "/api/email/v1" });

  app.setErrorHandler(errorHandler);
  return app;
}
