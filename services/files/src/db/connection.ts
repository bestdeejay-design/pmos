import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const baseUrl = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";

// Schema isolation per service (ADR-004). search_path is sent as a protocol
// startup parameter so EVERY pooled connection gets it — a one-off
// `SET search_path` only covers the single connection it ran on, and
// concurrent queries (e.g. NATS subscribers) then hit the wrong schema.
// postgres.js forwards any unknown URL query key into the startup message.
const url = new URL(baseUrl);
url.searchParams.set("search_path", schemaName);
const client = postgres(url.toString(), { onnotice: () => {} });
export const db = drizzle(client, { schema });
export { schema };
