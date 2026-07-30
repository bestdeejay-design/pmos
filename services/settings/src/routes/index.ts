import type { FastifyPluginAsync } from "fastify";

// TODO(svc-settings): implement routes to match contracts/openapi/settings.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "settings" }));
};
