import type { FastifyPluginAsync } from "fastify";

// TODO(svc-projects): implement routes to match contracts/openapi/projects.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "projects" }));
};
