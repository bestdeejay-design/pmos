import "dotenv/config";
import { buildApp } from "./app.js";
import { EventBus } from "@pmos/event-bus";
import { logger } from "./lib/errors.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  logger.info({ service: "ops", port: PORT }, "service started");

  const bus = EventBus.init({ serviceName: "ops" });
  try {
    await bus.connect();
    await bus.ensureStream();
    logger.info({ service: "ops" }, "event bus connected");
  } catch (err) {
    logger.error({ err }, "event bus unavailable — DLQ panel will error on request");
  }

  const shutdown = async () => {
    await bus.close().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});