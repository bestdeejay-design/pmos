import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
const client = postgres(url, { onnotice: () => {} });
await client.unsafe(`SET search_path TO "${schemaName}"`);
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./migrations" });
console.log("migrations applied for", process.env.SERVICE_NAME);
await client.end();
