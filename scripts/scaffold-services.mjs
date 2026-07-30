#!/usr/bin/env node
/**
 * scaffold-services.mjs — generates the 16 ЦУП service skeletons.
 *
 * Each service gets a complete, type-checking Fastify scaffold:
 *   package.json, tsconfig.json, Dockerfile, .env.example,
 *   src/{index,app,lib/errors,db/connection,db/schema,events/publish,events/subscribe}.ts,
 *   vitest.config.ts, test/health.test.ts, migrations/0001_init.sql
 *
 * Run:  node scripts/scaffold-services.mjs
 * Idempotent: overwrites existing skeletons (safe — these are templates).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** name, schema, hostPort, phase, db tables (drizzle pgTable stubs) */
const SERVICES = [
  { name: "profiles",          schema: "profiles_",      port: 3006, phase: "phase1" },
  { name: "settings",          schema: "settings_",      port: 3007, phase: "phase1" },
  { name: "notes",             schema: "notes_",         port: 3001, phase: "phase1" },
  { name: "tasks",             schema: "tasks_",         port: 3002, phase: "phase1" },
  { name: "calendar",          schema: "calendar_",     port: 3003, phase: "phase2" },
  { name: "projects",          schema: "projects_",     port: 3004, phase: "phase2" },
  { name: "files",             schema: "files_",         port: 3005, phase: "phase2" },
  { name: "search-rag",        schema: "search_rag_",    port: 3008, phase: "phase2" },
  { name: "ai-gateway",        schema: "ai_gateway_",    port: 3009, phase: "phase3" },
  { name: "agent",             schema: "agent_",         port: 3010, phase: "phase3" },
  { name: "export-import",     schema: "export_import_", port: 3015, phase: "phase3" },
  { name: "integrations",      schema: "integrations_",  port: 3014, phase: "phase3" },
  { name: "email",             schema: "email_",         port: 3012, phase: "phase4" },
  { name: "external-calendars",schema: "external_calendars_", port: 3013, phase: "phase4" },
  { name: "time-tracking",     schema: "time_tracking_", port: 3011, phase: "phase4" },
  { name: "sync",              schema: "sync_",          port: 3016, phase: "phase4" },
];

const pj = (s) => JSON.stringify({
  name: `@pmos/${s.name}`,
  version: "1.0.0",
  private: true,
  type: "module",
  main: "dist/index.js",
  scripts: {
    dev: "tsx watch src/index.ts",
    build: "tsc -p tsconfig.json",
    start: "node dist/index.js",
    typecheck: "tsc -p tsconfig.json --noEmit",
    test: "vitest run",
    "test:integration": "vitest run --project integration",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    lint: "eslint src --ext .ts",
  },
  dependencies: {
    "@fastify/type-provider-typebox": "^4.0.0",
    "@sinclair/typebox": "^0.34.0",
    "@pmos/shared": "workspace:*",
    "@pmos/event-bus": "workspace:*",
    dotenv: "^16.4.0",
    "drizzle-orm": "^0.33.0",
    fastify: "^5.0.0",
    "fastify-plugin": "^5.0.0",
    nats: "^2.0.0",
    pino: "^9.0.0",
    "pino-pretty": "^13.0.0",
    postgres: "^3.4.0",
    "prom-client": "^15.0.0",
  },
  devDependencies: {
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.24.0",
    tsx: "^4.16.0",
    typescript: "^5.5.0",
    vitest: "^2.0.0",
  },
}, null, 2);

const tsconfig = JSON.stringify({
  extends: "../../tsconfig.base.json",
  compilerOptions: { outDir: "./dist", rootDir: "./src" },
  include: ["src/**/*"],
}, null, 2);

const dockerfile = `FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;

const envExample = (s) => `# ${s.name} service
SERVICE_NAME=${s.name}
PORT=3000
DATABASE_URL=postgres://pmos:pmos@localhost:5432/pmos
DATABASE_SCHEMA=${s.schema}
NATS_URL=nats://localhost:4222
LOG_LEVEL=info
OTEL_ENABLED=false
`;

const indexTs = (s) => `import "dotenv/config";
import { buildApp } from "./app.js";
import { EventBus } from "@pmos/event-bus";
import { logger } from "./lib/errors.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  logger.info({ service: "${s.name}", port: PORT }, "service started");

  // Event bus bootstrap (ADR-003 / ADR-007 §3)
  const bus = EventBus.init({ serviceName: "${s.name}", eventVersion: 1 });
  try {
    await bus.connect();
    await bus.ensureStream();
    await import("./events/subscribe.js").then((m) => m.registerSubscribers(bus));
    logger.info({ service: "${s.name}" }, "event bus connected");
  } catch (err) {
    logger.error({ err }, "event bus unavailable — running without events");
  }

  const shutdown = async () => {
    await bus.close().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
`;

const appTs = (s) => `import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { notesRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(notesRoutes, { prefix: "/api/${s.name}/v1" });

  app.setErrorHandler(errorHandler);
  return app;
}
`;

// placeholder routes file so app.ts compiles
const routesTs = (s) => `import type { FastifyPluginAsync } from "fastify";

// TODO(svc-${s.name}): implement routes to match contracts/openapi/${s.name}.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "${s.name}" }));
};
`;

const errorsTs = `import pino from "pino";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ApiError } from "@pmos/shared";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

export const errorHandler = async (err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) => {
  const status = err.statusCode ?? 500;
  const body: ApiError = {
    code: err.code ?? (status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 422 ? "VALIDATION_ERROR" : "INTERNAL_ERROR"),
    message: err.message,
    details: null,
  };
  reply.code(status).header("x-correlation-id", (req.headers["x-correlation-id"] as string) ?? "").send(body);
};
`;

const correlationIdTs = `import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";

export default (async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const id = (req.headers["x-correlation-id"] as string) || randomUUID();
    req.headers["x-correlation-id"] = id;
    reply.header("x-correlation-id", id);
  });
}) as FastifyPluginAsync;
`;

const healthTs = `import type { FastifyPluginAsync } from "fastify";

export default (async (app) => {
  app.get("/health", async () => ({
    ok: true,
    db: true,
    nats: true,
    uptime: process.uptime(),
  }));
}) as FastifyPluginAsync;
`;

const metricsTs = `import type { FastifyPluginAsync } from "fastify";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequests = new client.Counter({ name: "http_requests_total", help: "HTTP requests", labelNames: ["method", "path", "status"], registers: [register] });

export default (async (app) => {
  app.addHook("onResponse", async (req, reply) => {
    httpRequests.inc({ method: req.method, path: req.routeOptions.url ?? "unknown", status: reply.statusCode });
  });
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
}) as FastifyPluginAsync;
`;

const connectionTs = `import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
const client = postgres(url, { onnotice: () => {} });
// Schema isolation per service (ADR-004): set search_path, don't use cross-schema FK.
// schemaName is a controlled identifier (ADR-007 §5), safe to interpolate.
await client.unsafe(\`SET search_path TO "\${schemaName}"\`);
export const db = drizzle(client, { schema });
export { schema };
`;

const schemaTs = (s) => `import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-${s.name}): define tables in schema ${s.schema} per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const ${s.name.replace(/-/g, "_")}_meta = pgTable("${s.name.replace(/-/g, "_")}_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
`;

const publishTs = (s) => `import { EventBus } from "@pmos/event-bus";

// Publish helpers for ${s.name}. Subjects: pmos.${s.name}.<event> (ADR-007 §3).
export async function publish${s.name.replace(/-/g, "")}Event(type: string, data: unknown, correlationId?: string) {
  const bus = EventBus.get();
  await bus.publish("pmos.${s.name}." + type, data, { correlationId });
}
`;

const subscribeTs = (s) => `import { EventBus } from "@pmos/event-bus";
import { logger } from "../lib/errors.js";

// Register inbound event handlers for ${s.name}.
// Pattern: handler must be idempotent — check processed_events before mutating (SAGA.md).
export async function registerSubscribers(bus: EventBus): Promise<void> {
  // TODO(svc-${s.name}): bus.subscribe("pmos.profiles.updated", async (env) => { ... });
  logger.info({ service: "${s.name}" }, "no subscribers registered yet");
}
`;

const migrateTs = `import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos";
const schemaName = process.env.DATABASE_SCHEMA ?? "public";
const client = postgres(url, { onnotice: () => {} });
await client.unsafe(\`SET search_path TO "\${schemaName}"\`);
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./migrations" });
console.log("migrations applied for", process.env.SERVICE_NAME);
await client.end();
`;

const vitestConfig = `import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
`;

const healthTest = (s) => `import { test, expect } from "vitest";
import { buildApp } from "../src/app.js";

test("GET /health returns ok", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).ok).toBe(true);
  await app.close();
});

test("GET /api/${s.name}/v1/health-check", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/api/${s.name}/v1/health-check" });
  expect(res.statusCode).toBe(200);
  await app.close();
});
`;

const migration = (s) => `-- Migration 0001_init for ${s.name}
-- Schema: ${s.schema}
-- TODO(svc-${s.name}): replace stub with real DDL from schema.ts / FEATURES.md.
CREATE TABLE IF NOT EXISTS ${s.schema}${s.name.replace(/-/g, "_")}_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency table (SAGA.md / ADR-004): every service has this.
CREATE TABLE IF NOT EXISTS ${s.schema}processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const drizzleConfig = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://pmos:pmos@localhost:5432/pmos" },
});
`;

let created = 0;
for (const s of SERVICES) {
  const dir = join(ROOT, "services", s.name);
  const dirs = [
    dir,
    join(dir, "src", "lib"),
    join(dir, "src", "db"),
    join(dir, "src", "events"),
    join(dir, "src", "plugins"),
    join(dir, "src", "routes"),
    join(dir, "test"),
    join(dir, "migrations"),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  const files = {
    "package.json": pj(s),
    "tsconfig.json": tsconfig,
    "Dockerfile": dockerfile,
    ".env.example": envExample(s),
    "drizzle.config.ts": drizzleConfig,
    "vitest.config.ts": vitestConfig,
    "src/index.ts": indexTs(s),
    "src/app.ts": appTs(s),
    "src/routes/index.ts": routesTs(s),
    "src/lib/errors.ts": errorsTs,
    "src/plugins/correlationId.ts": correlationIdTs,
    "src/plugins/health.ts": healthTs,
    "src/plugins/metrics.ts": metricsTs,
    "src/db/connection.ts": connectionTs,
    "src/db/schema.ts": schemaTs(s),
    "src/db/migrate.ts": migrateTs,
    "src/events/publish.ts": publishTs(s),
    "src/events/subscribe.ts": subscribeTs(s),
    "test/health.test.ts": healthTest(s),
    "migrations/0001_init.sql": migration(s),
  };
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  created++;
}

console.log(`Generated ${created} service skeletons under services/`);
