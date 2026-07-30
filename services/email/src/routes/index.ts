import type { FastifyPluginAsync } from "fastify";

// TODO(svc-email): implement routes to match contracts/openapi/email.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "email" }));
};
