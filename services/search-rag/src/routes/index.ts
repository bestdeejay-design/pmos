import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

// Best-effort event publish. Skipped silently if the bus isn't initialised
// (e.g. unit tests) or NATS is unreachable — never breaks the HTTP request.
function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error('[event] publish ' + subject + ' failed:', e));
  } catch {
    /* EventBus not initialised — skip */
  }
}

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

export const searchRagRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "search-rag" }));

  typed.post("/search", {
    schema: { body: Type.Object({
      query: Type.String(),
      type: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      projectId: Type.Optional(Type.String({ format: "uuid" })),
      profileIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
      limit: Type.Optional(Type.Integer()),
    }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    const rows = await db.select().from(schema.embeddings).limit(Number(body.limit ?? 20));
    return reply.send({ results: rows, semantic: false, total: rows.length });
  });

};
