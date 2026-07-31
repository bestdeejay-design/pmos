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

export const aiGatewayRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "ai-gateway" }));

  async function logAndEcho(kind: string, req: any, reply: any) {
    const body = req.body as any;
    await db.insert(schema.aiRequestLog).values({ kind, model: body.model ?? null, promptChars: String(body.text ?? "").length }).returning();
    return reply.send({ text: body.text ?? "" });
  }

  typed.post("/restore-punctuation", {
    schema: { body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (req, reply) => logAndEcho("restore_punctuation", req, reply));

  typed.post("/dictate", {
    schema: { body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    await db.insert(schema.aiRequestLog).values({ kind: "dictate", model: body.model ?? null, promptChars: String(body.text ?? "").length }).returning();
    const words = String(body.text ?? "").trim().split(/\s+/).filter(Boolean);
    const title = words.slice(0, 5).join(" ") || "Untitled";
    return reply.send({ title, bodyMd: body.text ?? "", tag: "note" });
  });

};
