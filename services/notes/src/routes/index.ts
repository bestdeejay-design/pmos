import type { FastifyPluginAsync } from "fastify";

// TODO(svc-notes): implement routes to match contracts/openapi/notes.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "notes" }));
};
