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

export const exportImportRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "export-import" }));

  typed.get("/export", {
    schema: { querystring: Type.Object({ format: Type.Optional(Type.String()) }) },
  }, async (_req, reply) =>
    reply.header("content-type", "application/zip").send(Buffer.from("PK\x05\x06")));

  typed.post("/import", {
    schema: { body: Type.Object({ format: Type.String(), content: Type.String(), target: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ importedNotes: 0, importedTasks: 0, importedCalendars: 0 }));

};
