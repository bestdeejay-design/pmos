import type { FastifyPluginAsync } from "fastify";

// TODO(svc-calendar): implement routes to match contracts/openapi/calendar.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "calendar" }));
};
