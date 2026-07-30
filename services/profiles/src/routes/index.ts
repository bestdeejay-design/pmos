import type { FastifyPluginAsync } from "fastify";

// TODO(svc-profiles): implement routes to match contracts/openapi/profiles.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "profiles" }));
};
