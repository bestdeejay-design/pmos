import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FastifyReply } from "fastify/types/reply.js";
import fp from "fastify-plugin";
import client from "prom-client";

/**
 * Плагин метрик Prometheus.
 *
 * Экспонирует GET /metrics с:
 * - http_requests_total — счётчик запросов (method, path, status)
 * - http_request_duration_ms — гистограмма длительности (method, path)
 * - Default metrics (GC, CPU, память)
 */

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"] as const,
});

const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "path"] as const,
  buckets: [50, 200, 500, 1000, 5000],
});

// Collect default metrics (GC, CPU, event loop, memory)
client.collectDefaultMetrics({});

async function metricsPlugin(fastify: FastifyInstance): Promise<void> {
  // Обновляем метрики после каждого ответа
  fastify.addHook(
    "onResponse",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Нормализуем путь (без динамических сегментов)
      const path = request.routeOptions?.url ?? request.url;
      const duration = reply.elapsedTime;

      httpRequestsTotal.inc({
        method: request.method,
        path,
        status: reply.statusCode,
      });

      httpRequestDurationMs.observe(
        { method: request.method, path },
        duration,
      );
    },
  );

  // Экспонируем /metrics
  fastify.get("/metrics", async (_request, reply) => {
    const metrics = await client.register.metrics();
    return reply.type("text/plain").send(metrics);
  });
}

export { httpRequestsTotal, httpRequestDurationMs };

export default fp(metricsPlugin, {
  name: "metrics",
});
