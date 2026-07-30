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
