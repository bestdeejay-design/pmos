import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
const client = postgres(url, { onnotice: () => {} });
// Schema isolation per service (ADR-004): set search_path, don't use cross-schema FK.
// schemaName is a controlled identifier (ADR-007 §5), safe to interpolate.
await client.unsafe(`SET search_path TO "${schemaName}"`);
export const db = drizzle(client, { schema });
export { schema };
