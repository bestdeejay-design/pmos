import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";

process.env["SERVICE_NAME"] = "test-service";
process.env["PORT"] = "0"; // random port
process.env["DATABASE_URL"] = "postgres://localhost:5432/test_db";
process.env["NATS_URL"] = "nats://localhost:4222";
process.env["LOG_LEVEL"] = "silent";

describe("Health endpoint", () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (addr && typeof addr === "object") {
      port = addr.port;
    } else {
      throw new Error("Failed to get server port");
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 with ok: false (no db/nats)", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toHaveProperty("ok", false);
    expect(body).toHaveProperty("service", expect.any(String));
    expect(body).toHaveProperty("uptime", expect.any(Number));
    expect(body).toHaveProperty("db");
    expect(body).toHaveProperty("nats");
  });

  it("GET /health has correct response shape", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();

    expect(body).toMatchObject({
      ok: expect.any(Boolean),
      service: expect.any(String),
      uptime: expect.any(Number),
      db: expect.any(String),
      nats: expect.any(String),
    });
  });

  it("GET /metrics returns prometheus metrics", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("http_requests_total");
    expect(text).toContain("http_request_duration_ms");
  });
});
