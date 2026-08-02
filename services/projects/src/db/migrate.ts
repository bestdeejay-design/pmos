import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos";

// Schema per service (ADR-004). Derive from the package name when DATABASE_SCHEMA
// is not set, so `pnpm -r run db:migrate` works without per-service env.
// "@pmos/search-rag" → "search_rag_".
function deriveSchemaName(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
  const svc = process.env.SERVICE_NAME ?? pkg.name?.replace(/^@pmos\//, "") ?? "public";
  return `${svc.replace(/-/g, "_")}_`;
}

const schemaName = process.env.DATABASE_SCHEMA ?? deriveSchemaName();
const client = postgres(url, { onnotice: () => {} });
await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
await client.unsafe(`SET search_path TO "${schemaName}"`);
const db = drizzle(client);

// Per-service migration tracking table (ADR-004 schema isolation). drizzle-kit's
// default tracking table is shared across the DB; with 16 services each shipping a
// 0000_init.sql of the same name, the first applied migration would make the rest
// silently skip. Isolating the table per schema prevents that collision.
await migrate(db, { migrationsFolder: "./migrations", migrationsTable: `${schemaName}_migrations` });
console.log("migrations applied for", schemaName);
await client.end();
