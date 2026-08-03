import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { apiKeys, webhooks, webhookDeliveries } from "../src/db/schema.js";
import { inArray, like } from "drizzle-orm";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/integrations/v1";

describe.skipIf(!HAS_DB)("integrations (real Postgres): api-keys + webhooks + deliveries", () => {
  let app: any;
  let webhookId: string;

  // Only delete this suite's own api-keys (Zapier/Temp) and webhooks
  // (https://example.com). It runs in parallel with integration.public-api
  // (pub-* keys, local mock) and integration.saga-webhook (127.0.0.1) — wiping
  // whole tables here would delete their rows mid-run (flaky). Deleting only
  // rows inserted by this file keeps every suite's setup isolated.
  async function deleteOwn() {
    const ownKeys = await db.select({ id: apiKeys.id }).from(apiKeys)
      .where(inArray(apiKeys.name, ["Zapier", "Temp"]));
    const keyIds = ownKeys.map((r) => r.id);
    if (keyIds.length > 0) await db.delete(apiKeys).where(inArray(apiKeys.id, keyIds));

    const ownHooks = await db.select({ id: webhooks.id }).from(webhooks)
      .where(like(webhooks.url, "https://example.com%"));
    const hookIds = ownHooks.map((r) => r.id);
    if (hookIds.length > 0) {
      await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, hookIds));
      await db.delete(webhooks).where(inArray(webhooks.id, hookIds));
    }
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await deleteOwn();
  });

  afterAll(async () => {
    await deleteOwn();
    if (app) await app.close();
  });

  it("POST /api-keys returns a raw pk_ key exactly once", async () => {
    const r = await app.inject({ method: "POST", url: `${BASE}/api-keys`, payload: { name: "Zapier" } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeTypeOf("string");
    expect(body.key).toMatch(/^pk_[0-9a-f]{64}$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 8));
  });

  it("GET /api-keys never exposes keyHash or the raw key", async () => {
    const r = await app.inject({ method: "GET", url: `${BASE}/api-keys` });
    expect(r.statusCode).toBe(200);
    const data = r.json().data as any[];
    expect(data.length).toBeGreaterThan(0);
    for (const k of data) {
      expect(k.key).toBeUndefined();
      expect(k.keyHash).toBeUndefined();
      expect(k.keyPrefix).toBeTypeOf("string");
    }
  });

  it("DELETE /api-keys/:id removes the key", async () => {
    const created = await app.inject({ method: "POST", url: `${BASE}/api-keys`, payload: { name: "Temp" } });
    const id = created.json().id;
    const del = await app.inject({ method: "DELETE", url: `${BASE}/api-keys/${id}` });
    expect(del.statusCode).toBe(204);
    const miss = await app.inject({ method: "DELETE", url: `${BASE}/api-keys/${id}` });
    expect(miss.statusCode).toBe(404);
  });

  it("webhooks CRUD round-trip", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/webhooks`,
      payload: { url: "https://example.com/hook", events: ["notes.created", "tasks.updated"], secret: "s3cret" },
    });
    expect(r.statusCode).toBe(201);
    const created = r.json();
    webhookId = created.id;
    expect(created.active).toBe(true);

    const list = await app.inject({ method: "GET", url: `${BASE}/webhooks` });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((w: any) => w.id === webhookId)).toBe(true);

    const patch = await app.inject({ method: "PATCH", url: `${BASE}/webhooks/${webhookId}`, payload: { active: false } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().active).toBe(false);

    const del = await app.inject({ method: "DELETE", url: `${BASE}/webhooks/${webhookId}` });
    expect(del.statusCode).toBe(204);
  });

  it("GET /webhooks/:id/deliveries returns paginated history", async () => {
    const hook = await app.inject({
      method: "POST",
      url: `${BASE}/webhooks`,
      payload: { url: "https://example.com/hook", events: ["notes.created"] },
    });
    const hookId = hook.json().id;
    await db.insert(webhookDeliveries).values({
      webhookId: hookId,
      eventId: null,
      eventType: "pmos.notes.notes.created",
      payload: { id: "evt-1" },
      status: "delivered",
      attempts: 1,
    });

    const r = await app.inject({ method: "GET", url: `${BASE}/webhooks/${hookId}/deliveries` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("delivered");
    expect(body.pagination.total).toBe(1);
  });
});
