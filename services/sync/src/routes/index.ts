import type { FastifyPluginAsync } from "fastify";

// TODO(svc-sync): implement routes to match contracts/openapi/sync.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "sync" }));
};
