import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { logger } from "../lib/logger.js";

const migrationsFolder = "./drizzle";

/**
 * Программный запуск Drizzle-миграций.
 *
 * Используется:
 * - В docker-entrypoint при старте контейнера
 * - Локально: npm run db:migrate
 *
 * Миграции генерируются через:
 *   npm run db:generate
 * (drizzle-kit generate)
 */
async function runMigrations(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.error("DATABASE_URL is required for migrations");
    process.exit(1);
  }

  logger.info({ migrationsFolder }, "Running database migrations");

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  await client.end();

  logger.info("Migrations completed successfully");
}

runMigrations().catch((cause) => {
  logger.error({ cause }, "Migration failed");
  process.exit(1);
});
