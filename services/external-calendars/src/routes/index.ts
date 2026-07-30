import type { FastifyPluginAsync } from "fastify";

// TODO(svc-external-calendars): implement routes to match contracts/openapi/external-calendars.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "external-calendars" }));
};
