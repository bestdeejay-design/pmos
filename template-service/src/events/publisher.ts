import { connect, type NatsConnection } from "nats";
import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";

/**
 * NATS publisher — обёртка для публикации событий.
 *
 * Событие сериализуется в JSON с обязательными метаданными:
 * - id: UUID
 * - type: "notes.created" | "tasks.updated" | ...
 * - source: имя сервиса
 * - timestamp: ISO 8601
 * - correlationId: для трейсинга
 * - data: тело события
 * - version: версия схемы
 */

export interface Event<D = Record<string, unknown>> {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  data: D;
  correlationId: string;
  version: number;
}

let nc: NatsConnection | null = null;

/**
 * Подключиться к NATS.
 */
export async function connectNats(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) {
    return nc;
  }

  logger.info({ url: env.NATS_URL }, "Connecting to NATS");

  nc = await connect({
    servers: [env.NATS_URL],
    name: env.SERVICE_NAME,
    pingInterval: 5000,
    maxReconnectAttempts: -1, // бесконечные реконнекты
  });

  logger.info(
    { server: nc.getServer() },
    "Connected to NATS",
  );

  nc.closed()
    .then(() => {
      logger.warn("NATS connection closed");
    })
    .catch((cause) => {
      logger.error({ cause }, "NATS connection closed with error");
    });

  return nc;
}

/**
 * Получить текущее NATS-подключение.
 * Выбрасывает ошибку, если не подключены.
 */
export function natsConnection(): NatsConnection {
  if (!nc || nc.isClosed()) {
    throw new Error("NATS not connected. Call connectNats() first.");
  }
  return nc;
}

/**
 * Проверить, подключены ли к NATS.
 */
export function isNatsConnected(): boolean {
  return nc !== null && !nc.isClosed();
}

/**
 * Опубликовать событие в NATS.
 *
 * @param subject — NATS subject (например "notes.created")
 * @param data — тело события
 * @param options.correlationId — опциональный correlationId
 * @param options.version — версия схемы (по умолчанию 1)
 * @returns true если опубликовано успешно
 */
export async function publish<D extends Record<string, unknown>>(
  subject: string,
  data: D,
  options?: { correlationId?: string; version?: number },
): Promise<boolean> {
  const connection = natsConnection();
  const event: Event<D> = {
    id: randomUUID(),
    type: subject,
    source: env.SERVICE_NAME,
    timestamp: new Date().toISOString(),
    data,
    correlationId: options?.correlationId ?? randomUUID(),
    version: options?.version ?? 1,
  };

  const payload = JSON.stringify(event);

  logger.info(
    {
      eventType: subject,
      eventId: event.id,
      correlationId: event.correlationId,
    },
    "Publishing event",
  );

  const js = connection.jetstream();

  // Авто-ретрансляция при ошибке
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await js.publish(subject, payload);
      logger.debug({ eventId: event.id, subject }, "Event published via JetStream");
      return true;
    } catch (cause) {
      logger.warn(
        { eventId: event.id, subject, attempt },
        "Failed to publish event, retrying...",
      );

      if (attempt === MAX_RETRIES) {
        logger.error(
          { eventId: event.id, subject, cause },
          "Failed to publish event after all retries",
        );
        return false;
      }

      // Экспоненциальная задержка: 100ms, 200ms, 400ms
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * Math.pow(2, attempt)),
      );
    }
  }

  return false;
}

/**
 * Закрыть NATS-подключение.
 */
export async function disconnectNats(): Promise<void> {
  if (nc && !nc.isClosed()) {
    logger.info("Closing NATS connection");
    await nc.drain();
    nc = null;
    logger.info("NATS connection closed");
  }
}
