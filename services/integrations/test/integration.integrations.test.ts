import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { apiKeys, webhooks, webhookDeliveries } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/integrations/v1";

describe.skipIf(!HAS_DB)("integrations (real Postgres): api-keys + webhooks + deliveries", () => {
  let app: any;
  let webhookId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(webhookDeliveries);
    await db.delete(apiKeys);
    await db.delete(webhooks);
  });

  afterAll(async () => {
    await db.delete(webhookDeliveries);
    await db.delete(apiKeys);
    await db.delete(webhooks);
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
