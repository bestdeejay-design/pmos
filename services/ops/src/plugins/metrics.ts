import type { FastifyPluginAsync } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
const serviceName = process.env.SERVICE_NAME ?? pkg.name?.replace(/^@pmos\//, "") ?? "unknown";
const serviceVersion = pkg.version ?? "0.0.0";

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests",
  labelNames: ["method", "path", "status"],
  registers: [register],
});
const httpDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration (ms)",
  labelNames: ["method", "path", "status"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});
const serviceInfo = new client.Gauge({
  name: "service_info",
  help: "Service build info",
  labelNames: ["service", "version"],
  registers: [register],
});
serviceInfo.labels(serviceName, serviceVersion).set(1);

export const metrics = {};

export default (async (app) => {
  app.addHook("onRequest", async (req) => {
    (req as { start?: number }).start = Date.now();
  });
  app.addHook("onResponse", async (req, reply) => {
    const start = (req as { start?: number }).start ?? Date.now();
    const status = reply.statusCode;
    const path = req.routeOptions.url ?? "unknown";
    httpRequests.inc({ method: req.method, path, status });
    httpDuration.observe({ method: req.method, path, status }, Date.now() - start);
  });
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
}) as FastifyPluginAsync;