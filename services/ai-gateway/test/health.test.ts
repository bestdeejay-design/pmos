import { test, expect, vi } from "vitest";
import { buildApp } from "../src/app.js";

vi.mock("../src/db/connection.js", () => ({
  db: { execute: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@pmos/event-bus", () => ({
  EventBus: {
    init: vi.fn(),
    get: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      ensureStream: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn(() => true),
    })),
  },
}));

test("GET /health returns ok when dependencies are healthy", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.ok).toBe(true);
  expect(body.db).toBe(true);
  expect(body.nats).toBe(true);
  expect(typeof body.uptime).toBe("number");
  await app.close();
});
