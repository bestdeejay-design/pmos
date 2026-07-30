import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status;
  e.code = code;
  throw e;
}

async function totalOf(t: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).limit(1);
  return r[0]?.total ?? 0;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "settings" }));

  typed.get("/", async (_req, reply) => {
    const rows = await db.select().from(schema.settings);
    return reply.send({ data: rows });
  });

  typed.get("/:key", {
    schema: { params: Type.Object({ key: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "setting not found");
    return reply.send(row);
  });

  typed.post("/", {
    schema: { body: Type.Object({ key: Type.String(), value: Type.Any() }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    const [row] = await db.insert(schema.settings).values({ key: body.key, value: body.value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: body.value, updatedAt: new Date() } }).returning();
    return reply.code(200).send(row);
  });

  typed.delete("/:key", {
    schema: { params: Type.Object({ key: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).returning();
    if (!row) return fail(404, "NOT_FOUND", "setting not found");
    return reply.code(204).send();
  });

  typed.get("/ollama-models", async (_req, reply) => {
    return reply.send({ data: [] });
  });

};
