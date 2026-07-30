import { test, expect } from "vitest";
import { buildApp } from "../src/app.js";

test("GET /health returns ok", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).ok).toBe(true);
  await app.close();
});

test("GET /api/agent/v1/health-check", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/api/agent/v1/health-check" });
  expect(res.statusCode).toBe(200);
  await app.close();
});
