import type { FastifyPluginAsync } from "fastify";

// TODO(svc-time-tracking): implement routes to match contracts/openapi/time-tracking.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "time-tracking" }));
};
