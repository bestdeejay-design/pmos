import type { FastifyPluginAsync } from "fastify";

// TODO(svc-agent): implement routes to match contracts/openapi/agent.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "agent" }));
};
