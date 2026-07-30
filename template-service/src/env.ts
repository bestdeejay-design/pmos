import "dotenv/config";

/**
 * Переменные окружения с валидацией.
 *
 * Все обязательные переменные проверяются при импорте.
 * Сервис не запустится, если не хватает required-переменной.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Check .env.example for all required variables.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  SERVICE_NAME: required("SERVICE_NAME"),
  PORT: optional("PORT", "3000"),
  DATABASE_URL: required("DATABASE_URL"),
  NATS_URL: required("NATS_URL"),
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
  CORRELATION_ID: optional("CORRELATION_ID", ""),
  NODE_ENV: optional("NODE_ENV", "development"),
} as const;
