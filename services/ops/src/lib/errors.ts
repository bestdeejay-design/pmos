import pino from "pino";
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