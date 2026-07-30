import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { connectNats, disconnectNats } from "./events/publisher.js";
import { disconnect } from "./db/connection.js";

/**
 * Entry point сервиса.
 *
 * 1. Загружает env (уже импортирован выше — dotenv/config)
 * 2. Создаёт Fastify app
 * 3. Подключается к NATS
 * 4. Запускает HTTP-сервер
 * 5. Регистрирует graceful shutdown (SIGTERM / SIGINT)
 */

async function main(): Promise<void> {
  logger.info(
    { service: env.SERVICE_NAME, nodeEnv: env.NODE_ENV },
    "Starting service",
  );

  // ─── Создаём Fastify app ──────────────────────────
  const app = await createApp();

  // ─── Подключаемся к NATS ──────────────────────────
  // NATS не блокирует запуск сервера — реконнект встроен
  connectNats().catch((cause) => {
    logger.warn({ cause }, "NATS connection failed (will retry in background)");
  });

  // ─── Graceful shutdown ─────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    const timeout = setTimeout(() => {
      logger.error("Forced exit after 10s timeout");
      process.exit(1);
    }, 10_000);

    timeout.unref();

    try {
      // 1. Останавливаем HTTP-сервер (перестаём принимать новые запросы)
      logger.info("Closing HTTP server...");
      await app.close();

      // 2. Закрываем NATS
      await disconnectNats();

      // 3. Закрываем БД
      await disconnect();

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (cause) {
      logger.error({ cause }, "Error during graceful shutdown");
      process.exit(1);
    } finally {
      clearTimeout(timeout);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ─── Запускаем сервер ─────────────────────────────
  try {
    const port = Number(env.PORT);
    const host = "0.0.0.0";

    await app.listen({ port, host });
    logger.info(
      { port, host, service: env.SERVICE_NAME },
      "Service started",
    );
  } catch (cause) {
    logger.fatal({ cause }, "Failed to start server");
    process.exit(1);
  }
}

main();
