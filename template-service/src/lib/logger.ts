import pino from "pino";
import { env } from "../env.js";

/**
 * Pino-инстанс сервиса.
 *
 * Уровень логирования читается из LOG_LEVEL (info | debug | warn | error).
 * Всегда пишет JSON в stdout — для docker compose и production.
 *
 * В development можно запустить с `pino-pretty` через pipe:
 *   npm run dev | pino-pretty
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  name: env.SERVICE_NAME,
  formatters: {
    level: (label) => ({ level: label }) as Record<string, unknown>,
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});
