import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";

/**
 * Плагин сквозного correlationId.
 *
 * Читает X-Correlation-Id из заголовка запроса или генерирует новый UUID.
 * Добавляет correlationId в request и в каждый лог-сообщение через logger.
 */

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

async function correlationIdPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest("correlationId", "");

  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    const correlationId =
      (request.headers["x-correlation-id"] as string | undefined) ??
      randomUUID();

    request.correlationId = correlationId;

    // Пробрасываем correlationId в логгер для каждого запроса
    request.log = request.log.child({ correlationId });
  });
}

export default fp(correlationIdPlugin, {
  name: "correlation-id",
});
