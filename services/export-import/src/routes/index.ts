import type { FastifyPluginAsync } from "fastify";

// TODO(svc-export-import): implement routes to match contracts/openapi/export-import.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "export-import" }));
};
