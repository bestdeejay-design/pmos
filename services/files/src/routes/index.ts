import type { FastifyPluginAsync } from "fastify";

// TODO(svc-files): implement routes to match contracts/openapi/files.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "files" }));
};
