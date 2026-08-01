import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:***@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";

// Schema isolation per service (ADR-004). Applied as a startup parameter so
// EVERY pooled connection gets it — a SET on one connection would leak into
// "relation does not exist" for concurrent queries on other pool members.
const client = postgres(url, {
  onnotice: () => {},
  connection: { options: `-csearch_path=${schemaName}` },
});
export const db = drizzle(client, { schema });
export { schema };
