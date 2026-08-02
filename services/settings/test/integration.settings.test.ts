import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { settings } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/settings/v1";

describe.skipIf(!HAS_DB)("settings (real Postgres): KV upsert + ollama-models", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(settings); // isolate test data
  });

  afterAll(async () => {
    await db.delete(settings); // best-effort cleanup
    if (app) await app.close();
  });

  it("upserts a KV setting (same key updates in place)", async () => {
    const first = await app.inject({
      method: "POST",
      url: `${BASE}/settings`,
      payload: { key: "gen_model", value: { name: "qwen2.5-coder" } },
    });
    expect(first.statusCode).toBe(201);
    expect((first.json() as any).value.name).toBe("qwen2.5-coder");

    const second = await app.inject({
      method: "POST",
      url: `${BASE}/settings`,
      payload: { key: "gen_model", value: { name: "llama3.1:8b" } },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as any).value.name).toBe("llama3.1:8b");

    const got = await app.inject({ method: "GET", url: `${BASE}/settings/gen_model` });
    expect(got.statusCode).toBe(200);
    expect((got.json() as any).value.name).toBe("llama3.1:8b");
  });

  it("ollama-models degrades gracefully when Ollama is unreachable", async () => {
    const prev = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = "http://127.0.0.1:1"; // nothing listens on port 1
    try {
      const r = await app.inject({ method: "GET", url: `${BASE}/settings/ollama-models` });
      expect(r.statusCode).toBe(200);
      const body = r.json() as any;
      expect(body.models).toEqual([]);
      expect(body.degraded).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_URL;
      else process.env.OLLAMA_URL = prev;
    }
  });

  it("§7.2 validation error: POST without a key returns 422", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/settings`,
      payload: { value: { a: 1 } },
    });
    expect(r.statusCode).toBe(422);
  });

  it("§7.3 pagination sorts by updatedAt ASC and respects limit/offset", async () => {
    const keys = ["pg_a", "pg_b", "pg_c", "pg_d", "pg_e"];
    for (let i = 0; i < keys.length; i++) {
      await app.inject({
        method: "POST",
        url: `${BASE}/settings`,
        payload: { key: keys[i], value: { idx: i } },
      });
    }

    const page = await app.inject({ method: "GET", url: `${BASE}/settings?offset=1&limit=2` });
    expect(page.statusCode).toBe(200);
    const body = page.json() as any;
    expect(body.pagination.total).toBeGreaterThanOrEqual(keys.length);
    expect(body.data.length).toBe(2);

    const idxs = body.data.map((s: any) => s.value.idx);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));

    for (const k of keys) await app.inject({ method: "DELETE", url: `${BASE}/settings/${k}` });
  });
});
