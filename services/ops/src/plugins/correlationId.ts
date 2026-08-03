import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";

export default (async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const id = (req.headers["x-correlation-id"] as string) || randomUUID();
    req.headers["x-correlation-id"] = id;
    reply.header("x-correlation-id", id);
  });
}) as FastifyPluginAsync;