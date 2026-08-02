import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { webhooks, webhookDeliveries } from "../src/db/schema.js";
import { scheduleWebhookDeliveries, attemptDelivery } from "../src/lib/webhook-delivery.js";
import type { EventEnvelope } from "@pmos/shared";

const HAS_DB = Boolean(process.env.DATABASE_URL);

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

describe.skipIf(!HAS_DB)("saga §5: webhook HTTP delivery + retry (real HTTP server)", () => {
  let app: any;
  let server: Server;
  let handler: Handler;
  let webhookId: string;
  let port: number;
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(webhookDeliveries);
    await db.delete(webhooks);

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        handler(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(webhookDeliveries);
    await db.delete(webhooks);
    if (app) await app.close();
  });

  async function createWebhook(events: string[], h: Handler): Promise<string> {
    handler = h;
    received.length = 0;
    const [row] = await db.insert(webhooks).values({
      url: `http://127.0.0.1:${port}/hook`,
      events,
      secret: "s3cret",
      active: true,
    }).returning({ id: webhooks.id });
    webhookId = row.id;
    return webhookId;
  }

  function makeEnvelope(type: string): EventEnvelope {
    return {
      id: randomUUID(),
      type,
      source: "notes",
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: randomUUID(),
      data: { title: "hello", bodyMd: "world" },
    };
  }

  async function pollDelivery<T>(predicate: (d: (typeof webhookDeliveries.$inferSelect) | undefined) => T | undefined, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [d] = await db.select().from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, webhookId)).limit(1);
      const res = predicate(d);
      if (res !== undefined) return res;
      if (Date.now() > deadline) throw new Error("pollDelivery timed out");
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it("delivers a POST with HMAC signature, X-Event-Type and X-Correlation-Id, then marks delivered", async () => {
    const correlationId = randomUUID();
    await createWebhook(["notes.created"], (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const env = makeEnvelope("pmos.notes.notes.created");
    env.correlationId = correlationId;
    await scheduleWebhookDeliveries(env);

    const delivery = await pollDelivery((d) => (d?.status === "delivered" ? d : undefined), 5000);
    expect(delivery.status).toBe("delivered");
    expect(received.length).toBe(1);
    const req = received[0];
    const signature = createHmac("sha256", "s3cret").update(req.body).digest("hex");
    expect(req.headers["x-webhook-signature"]).toBe(signature);
    expect(req.headers["x-event-type"]).toBe("notes.created");
    expect(req.headers["x-correlation-id"]).toBe(correlationId);
  });

  it("retries on 5xx, then delivers once the server recovers", async () => {
    let calls = 0;
    await createWebhook(["tasks.updated"], (_req, res) => {
      calls += 1;
      res.writeHead(calls === 1 ? 500 : 200);
      res.end("ok");
    });
    await scheduleWebhookDeliveries(makeEnvelope("pmos.tasks.tasks.updated"));

    const pending = await pollDelivery((d) => (d && d.attempts > 0 && d.status === "pending" ? d : undefined), 5000);
    expect(pending.attempts).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);

    const [delivery] = await db.select().from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId)).limit(1);
    await attemptDelivery(delivery.id);

    const delivered = await pollDelivery((d) => (d?.status === "delivered" ? d : undefined), 5000);
    expect(delivered.status).toBe("delivered");
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("marks a 4xx as failed_4xx without retry", async () => {
    await createWebhook(["files.files.created"], (_req, res) => {
      res.writeHead(400);
      res.end("bad");
    });
    await scheduleWebhookDeliveries(makeEnvelope("pmos.files.files.created"));
    const delivery = await pollDelivery((d) => (d?.status === "failed_4xx" ? d : undefined), 5000);
    expect(delivery.status).toBe("failed_4xx");
    expect(delivery.lastError).toContain("400");
  });
});