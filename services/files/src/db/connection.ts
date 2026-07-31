import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";

// Schema isolation per service (ADR-004). Apply search_path on connect.
// Guarded so importing this module in unit tests (no DATABASE_URL) stays side-effect free.
const client = postgres(url, { onnotice: () => {} });
if (process.env.DATABASE_URL) {
  await client.unsafe(`SET search_path TO "${schemaName}"`);
}
export const db = drizzle(client, { schema });
export { schema };
