import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { EventBus } from "@pmos/event-bus";

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

export const opsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "ops" }));

  // ───────────── DLQ panel ─────────────
  typed.get("/dlq", {
    schema: {
      querystring: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      response: { 200: Type.Object({ data: Type.Array(Type.Any()) }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 20);
    try {
      const entries = await EventBus.get().listDlq(limit);
      return reply.send({ data: entries });
    } catch (e: any) {
      return fail(500, "INTERNAL_ERROR", `DLQ list failed: ${e?.message ?? e}`);
    }
  });

  typed.post("/dlq/:id/replay", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: { 200: Type.Any() },
    },
  }, async (req, reply) => {
    const seq = Number((req.params as any).id);
    if (!Number.isInteger(seq) || seq < 1) {
      return fail(400, "VALIDATION_ERROR", "id must be a positive integer (stream seq)");
    }
    try {
      const subject = await EventBus.get().replayDlq(seq);
      return reply.send({ subject, seq });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (e?.code === 404 || msg.includes("no message found") || msg.includes("not a .dlq message")) {
        return fail(404, "NOT_FOUND", msg);
      }
      return fail(500, "INTERNAL_ERROR", `DLQ replay failed: ${msg}`);
    }
  });
};