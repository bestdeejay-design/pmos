import type { FastifyPluginAsync } from "fastify";

export default (async (app) => {
  app.get("/health", async () => ({
    ok: true,
    db: true,
    nats: true,
    uptime: process.uptime(),
  }));
}) as FastifyPluginAsync;
