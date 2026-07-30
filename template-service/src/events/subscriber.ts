import {
  type NatsConnection,
  type JetStreamSubscription,
  type JsMsg,
  consumerOpts,
} from "nats";
import { logger } from "../lib/logger.js";
import type { Event } from "./publisher.js";

/**
 * NATS subscriber — обёртка для JetStream pull consumer.
 *
 * - At-least-once доставка
 * - Ack после успешной обработки
 * - Nack с отсрочкой при временной ошибке
 * - Dead-letter после 3 неудач
 */

export interface MessageHandler<D = Record<string, unknown>> {
  (event: Event<D>): Promise<void> | void;
}

const DELIVERY_GROUP_DELAY_MS = 30_000; // 30 секунд для dead-letter Consumer

/**
 * Подписаться на NATS JetStream pull consumer.
 *
 * @param nc — NATS подключение
 * @param subject — subject для подписки (например "notes.created")
 * @param consumerName — имя consumer'а (должно быть уникальным для сервиса)
 * @param handler — обработчик события
 * @returns JetStreamSubscription — для отписки
 */
export async function subscribe<D extends Record<string, unknown>>(
  nc: NatsConnection,
  subject: string,
  consumerName: string,
  handler: MessageHandler<D>,
): Promise<JetStreamSubscription> {
  const js = nc.jetstream();

  const opts = consumerOpts();
  opts.durable(consumerName);
  opts.manualAck();
  opts.ackAll(); // ack при успехе пачки
  opts.maxDeliver(3); // max 3 попытки → dead-letter
  opts.ackWait(DELIVERY_GROUP_DELAY_MS);

  const sub = await js.subscribe(subject, opts);

  logger.info(
    { subject, consumerName },
    "Subscribed to JetStream consumer",
  );

  // Запускаем асинхронный цикл обработки
  processMessages(sub, subject, consumerName, handler).catch((cause) => {
    logger.error(
      { subject, consumerName, cause },
      "Message processing loop crashed",
    );
  });

  return sub;
}

async function processMessages<D extends Record<string, unknown>>(
  sub: JetStreamSubscription,
  subject: string,
  consumerName: string,
  handler: MessageHandler<D>,
): Promise<void> {
  for await (const msg of sub) {
    try {
      const event = parseEvent<D>(msg, subject);

      if (!event) {
        // Невалидное сообщение — в dead-letter
        msg.term();
        continue;
      }

      logger.debug(
        {
          eventType: event.type,
          eventId: event.id,
          correlationId: event.correlationId,
          consumerName,
        },
        "Processing event",
      );

      await handler(event);

      msg.ack();

      logger.debug(
        {
          eventId: event.id,
          consumerName,
        },
        "Event processed successfully",
      );
    } catch (cause) {
      logger.warn(
        { subject, consumerName, cause },
        "Failed to process event, will retry",
      );

      // Nack — JetStream перенаправит другому consumer или retry
      msg.nak(DELIVERY_GROUP_DELAY_MS);
    }
  }
}

/**
 * Парсит и валидирует входящее NATS-сообщение как Event.
 * Возвращает null при невалидном JSON/структуре.
 */
function parseEvent<D>(
  msg: JsMsg,
  subject: string,
): Event<D> | null {
  try {
    const raw = new TextDecoder().decode(msg.data);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Базовая валидация полей
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.type !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.timestamp !== "string" ||
      typeof parsed.version !== "number"
    ) {
      logger.error(
        { subject, rawData: raw.slice(0, 500) },
        "Received invalid event: missing required fields",
      );
      return null;
    }

    return parsed as unknown as Event<D>;
  } catch (cause) {
    logger.error(
      { subject, cause },
      "Failed to parse event JSON",
    );
    return null;
  }
}
