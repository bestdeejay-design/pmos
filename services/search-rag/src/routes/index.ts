import type { FastifyPluginAsync } from "fastify";

// TODO(svc-search-rag): implement routes to match contracts/openapi/search-rag.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "search-rag" }));
};
