import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { EventBus } from "@pmos/event-bus";

export default (async (app) => {
  app.get("/health", async (_req, reply) => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    let natsOk = false;
    try {
      natsOk = EventBus.get().isHealthy();
    } catch {
      natsOk = false;
    }
    const ok = dbOk && natsOk;
    const body = { ok, db: dbOk, nats: natsOk, uptime: process.uptime() };
    if (!ok) return reply.code(503).send(body);
    return body;
  });
}) as FastifyPluginAsync;
