import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { aiRequestLog } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("ai-gateway — real Postgres", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/ai-gateway/v1";

  beforeAll(async () => {
    app = await buildApp();
    // Isolate from data left by manual/E2E runs.
    await db.delete(aiRequestLog);
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => { await app?.close(); });

  it("POST /dictate returns a structured note (title/bodyMd/tag/degraded)", async () => {
    const r = await app.inject({
      method: "POST", url: `${base}/dictate`,
      payload: { text: "Купить молоко и хлеб завтра утром" },
    });
    expect(r.statusCode, "dictate status").toBe(200);
    const body = r.json() as { title: string; bodyMd: string; tag?: string; degraded: boolean };
    expect(typeof body.title).toBe("string");
    expect(typeof body.bodyMd).toBe("string");
    expect(typeof body.degraded).toBe("boolean");
    expect(body.title.length).toBeGreaterThan(0);
    expect(body.bodyMd.length).toBeGreaterThan(0);
  });

  it("POST /restore-punctuation returns text + degraded flag", async () => {
    const r = await app.inject({
      method: "POST", url: `${base}/restore-punctuation`,
      payload: { text: "привет как дела" },
    });
    expect(r.statusCode, "restore status").toBe(200);
    const body = r.json() as { text: string; degraded: boolean };
    expect(typeof body.text).toBe("string");
    expect(typeof body.degraded).toBe("boolean");
    expect(body.text.length).toBeGreaterThan(0);
  });

  it("never 500s on a bogus model — graceful degradation instead", async () => {
    const r = await app.inject({
      method: "POST", url: `${base}/restore-punctuation`,
      payload: { text: "тест", model: "no-such-model-xyz" },
    });
    expect(r.statusCode, "bogus model status").toBe(200);
    expect((r.json() as { degraded: boolean }).degraded).toBe(true);
  });

  it("validates required body fields (400)", async () => {
    const r = await app.inject({ method: "POST", url: `${base}/dictate`, payload: {} });
    expect(r.statusCode, "missing text").toBe(400);
  });

  it("logs each LLM call to ai_request_log", async () => {
    await app.inject({
      method: "POST", url: `${base}/dictate`,
      payload: { text: "Записать идею в проект" },
    });
    await app.inject({
      method: "POST", url: `${base}/restore-punctuation`,
      payload: { text: "ещё один текст" },
    });
    const rows = await db.select().from(aiRequestLog);
    const kinds = rows.map((x) => x.kind);
    expect(kinds).toContain("dictate");
    expect(kinds).toContain("restore_punctuation");
  });
});
