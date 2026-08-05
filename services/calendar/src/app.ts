import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import correlationId from "./plugins/correlationId.js";
import health from "./plugins/health.js";
import metrics from "./plugins/metrics.js";
import { errorHandler } from "./lib/errors.js";
import { EventBus } from "@pmos/event-bus";
import { calendarRoutes } from "./routes/index.js";
import { registerSubscribers } from "./events/subscribe.js";

export async function buildApp() {
  EventBus.init({ serviceName: "calendar", url: process.env.NATS_URL });
  // Best-effort: connect + ensure the JetStream stream exists. Skipped if NATS is down.
  await EventBus.get().connect().then(() => EventBus.get().ensureStream()).catch(() => {});
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(correlationId);
  await app.register(health);
  await app.register(metrics);
  await app.register(calendarRoutes, { prefix: "/api/calendar/v1" });

  app.setErrorHandler(errorHandler);

  // Wire event subscribers (best-effort, don't fail health-check if NATS is down)
  registerSubscribers(EventBus.get()).catch(() => {});

  // Reminder scheduler: fire due reminders every 30s, best-effort. Never throws.
  const pollMs = Number(process.env.REMINDER_POLL_MS ?? 30_000);
  const reminderTimer = setInterval(() => {
    import("./scheduler/reminders.js").then((m) =>
      m.fireDueReminders().catch((e) => console.error("[reminder] fire failed:", e)),
    );
  }, Math.max(pollMs, 1_000));
  app.addHook("onClose", async () => clearInterval(reminderTimer));

  return app;
}
