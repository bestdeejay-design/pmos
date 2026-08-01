import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";

// Schema isolation per service (ADR-004). postgres-js pools connections, so a
// per-connection `SET search_path` on one handle would leave the rest pointing at
// `public`; instead the URL carries `options=-c search_path=...`, which Postgres
// applies to every new connection in the pool.
// Guarded so importing this module in unit tests (no DATABASE_URL) stays side-effect free.
const sep = url.includes("?") ? "&" : "?";
const connUrl = process.env.DATABASE_URL
  ? `${url}${sep}options=-c%20search_path=${encodeURIComponent(schemaName)}`
  : url;
const client = postgres(connUrl, { onnotice: () => {} });
export const db = drizzle(client, { schema });
export { schema };
