import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
const client = postgres(url, { onnotice: () => {} });
await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
await client.unsafe(`SET search_path TO "${schemaName}"`);
const db = drizzle(client);

// Per-service migration tracking table (ADR-004 schema isolation). drizzle-kit's
// default tracking table is shared across the DB; with 16 services each shipping a
// 0000_init.sql of the same name, the first applied migration would make the rest
// silently skip. Isolating the table per schema prevents that collision.
await migrate(db, { migrationsFolder: "./migrations", migrationsTable: `${schemaName}_migrations` });
console.log("migrations applied for", process.env.SERVICE_NAME);
await client.end();
