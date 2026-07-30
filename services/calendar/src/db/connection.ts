import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
// Schema isolation per service (ADR-004): set search_path on connect. Using the Postgres
// connection `options` parameter applies it per-session without a top-level await, so this
// module imports cleanly without a live DB (unit tests only hit /health-check).
// `options` is a valid runtime param but not in postgres.js's TS types, hence the cast.
const client = postgres(url, {
  onnotice: () => {},
  options: `-c search_path="${schemaName}"`,
} as any);
export const db = drizzle(client, { schema });
export { schema };
