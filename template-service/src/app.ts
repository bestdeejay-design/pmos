import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import correlationIdPlugin from "./plugins/correlationId.js";
import healthPlugin from "./plugins/health.js";
import metricsPlugin from "./plugins/metrics.js";

/**
 * Fastify app factory.
 *
 * Создаёт инстанс Fastify со всеми cross-cutting плагинами:
 * - correlationId — сквозной идентификатор запроса
 * - health — GET /health
 * - metrics — GET /metrics + prom-client
 * - Error handler — типизованные ошибки
 * - Shutdown hooks — graceful shutdown
 *
 * Используется в index.ts для запуска и в тестах для создания app.
 */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      name: env.SERVICE_NAME,
      formatters: {
        level: (label: string) => ({ level: label }) as Record<string, unknown>,
      },
    },
    trustProxy: true,
  });

  // ─── Регистрация плагинов ───────────────────────────

  // CorrelationId — должен быть первым, чтобы был доступен в остальных плагинах
  await app.register(correlationIdPlugin);

  // Healthcheck
  await app.register(healthPlugin);

  // Metrics
  await app.register(metricsPlugin);

  // ─── Error handler ──────────────────────────────────

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const correlationId = request.correlationId;

    if (error instanceof AppError) {
      error.correlationId = correlationId;

      if (error.statusCode >= 500) {
        request.log.error({ err: error }, error.message);
      } else {
        request.log.warn({ err: error }, error.message);
      }

      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Fastify validation errors
    if ("validation" in error && error.validation) {
      request.log.warn(
        { err: error, validation: error.validation },
        error.message,
      );
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
          correlationId,
        },
      });
    }

    // Неизвестные ошибки — не показываем стек в production
    request.log.error({ err: error, correlationId }, "Unhandled error");

    const message =
      env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message;

    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message,
        correlationId,
      },
    });
  });

  // ─── Graceful shutdown hooks ────────────────────────

  app.addHook("onClose", async (_instance) => {
    logger.info("Fastify closing...");
  });

  return app;
}
