import type { FastifyPluginAsync } from "fastify";

// TODO(svc-integrations): implement routes to match contracts/openapi/integrations.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "integrations" }));
};
