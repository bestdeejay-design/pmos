import type { FastifyPluginAsync } from "fastify";

// TODO(svc-ai-gateway): implement routes to match contracts/openapi/ai-gateway.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "ai-gateway" }));
};
