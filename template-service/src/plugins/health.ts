import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { rawSql } from "../db/connection.js";
import { isNatsConnected, natsConnection } from "../events/publisher.js";
import { env } from "../env.js";

export interface HealthResponse {
  ok: boolean;
  service: string;
  uptime: number;
  db: "connected" | "error";
  nats: "connected" | "error";
}

/**
 * Healthcheck endpoint.
 *
 * GET /health → { ok, service, uptime, db, nats }
 *
 * Проверяет:
 * - Подключение к PostgreSQL (SELECT 1)
 * - Подключение к NATS (ping)
 */
async function healthPlugin(fastify: FastifyInstance): Promise<void> {
  const startTime = Date.now();

  fastify.get<{ Reply: HealthResponse }>(
    "/health",
    {
      logLevel: "warn", // Не засорять логи healthcheck'ами
    },
    async (_request, reply) => {
      let dbStatus: HealthResponse["db"] = "error";
      let natsStatus: HealthResponse["nats"] = "error";

      // Проверка БД
      try {
        await rawSql()`SELECT 1`;
        dbStatus = "connected";
      } catch (cause) {
        fastify.log.error({ cause }, "Healthcheck: database check failed");
      }

      // Проверка NATS
      try {
        if (isNatsConnected()) {
          await natsConnection().rtt();
          natsStatus = "connected";
        }
      } catch (cause) {
        fastify.log.error({ cause }, "Healthcheck: NATS ping failed");
      }

      const ok = dbStatus === "connected" && natsStatus === "connected";

      const response: HealthResponse = {
        ok,
        service: env.SERVICE_NAME,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        db: dbStatus,
        nats: natsStatus,
      };

      const statusCode = ok ? 200 : 503;
      return reply.code(statusCode).send(response);
    },
  );
}

export default fp(healthPlugin, {
  name: "health",
});
