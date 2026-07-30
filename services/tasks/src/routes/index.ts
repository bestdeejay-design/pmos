import type { FastifyPluginAsync } from "fastify";

// TODO(svc-tasks): implement routes to match contracts/openapi/tasks.yaml
export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health-check", async () => ({ ok: true, service: "tasks" }));
};
