import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import * as schema from "./schema.js";

let sqlClient: postgres.Sql<Record<string, never>> | null = null;

/**
 * Получить postgres.js клиент (ленивая инициализация).
 */
function getClient(): postgres.Sql<Record<string, never>> {
  if (!sqlClient) {
    logger.info(
      { url: maskDatabaseUrl(env.DATABASE_URL) },
      "Connecting to database",
    );
    sqlClient = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}

/**
 * Drizzle ORM инстанс с типизированной схемой.
 */
export const db = drizzle(getClient(), { schema });

/**
 * Raw postgres.js клиент для прямых SQL-запросов (healthcheck, миграции).
 */
export function rawSql(): postgres.Sql<Record<string, never>> {
  return getClient();
}

/**
 * Закрыть соединение с БД.
 */
export async function disconnect(): Promise<void> {
  if (sqlClient) {
    logger.info("Closing database connection");
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    logger.info("Database connection closed");
  }
}

/**
 * Маскирует URL для безопасного логирования.
 */
function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "<invalid-database-url>";
  }
}
