import type { FastifyPluginAsync } from "fastify";
import { EventBus } from "@pmos/event-bus";

export default (async (app) => {
  app.get("/health", async (_req, reply) => {
    let natsOk = false;
    try {
      natsOk = EventBus.get().isHealthy();
    } catch {
      natsOk = false;
    }
    const ok = natsOk;
    const body = { ok, db: true, nats: natsOk, uptime: process.uptime() };
    if (!ok) return reply.code(503).send(body);
    return body;
  });
}) as FastifyPluginAsync;