import type { FastifyPluginAsync } from "fastify";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequests = new client.Counter({ name: "http_requests_total", help: "HTTP requests", labelNames: ["method", "path", "status"], registers: [register] });

export default (async (app) => {
  app.addHook("onResponse", async (req, reply) => {
    httpRequests.inc({ method: req.method, path: req.routeOptions.url ?? "unknown", status: reply.statusCode });
  });
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
}) as FastifyPluginAsync;
