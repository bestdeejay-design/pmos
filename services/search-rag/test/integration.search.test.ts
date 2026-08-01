import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { embeddings, processedEvents } from "../src/db/schema.js";
import { upsertEmbedding } from "../src/events/subscribe.js";
import { EventBus } from "@pmos/event-bus";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_NATS = Boolean(process.env.NATS_URL ?? "nats://localhost:4222");
const BASE = "/api/search-rag/v1";

describe.skipIf(!HAS_DB)("search-rag (real Postgres)", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(embeddings);
    await db.delete(processedEvents);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("POST /search finds rows by ILIKE (case-insensitive)", async () => {
    const noteId = randomUUID();
    await db.insert(embeddings).values({
      entityType: "note",
      entityId: noteId,
      content: "Нужно купить молоко и хлеб",
      profileIds: [],
    });
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "молоко" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.semantic).toBe(false);
    expect(body.total).toBeGreaterThanOrEqual(1);
    const hit = (body.results as any[]).find((r) => r.entityId === noteId);
    expect(hit).toBeTruthy();
    expect(hit.type).toBe("note");
    expect(hit.content).toContain("молоко");
  });

  it("escapes LIKE wildcards — literal % does not act as a wildcard", async () => {
    await db.insert(embeddings).values({
      entityType: "note",
      entityId: randomUUID(),
      content: "100% готово",
      profileIds: [],
    });
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "%" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const hits = (body.results as any[]).filter((r) => r.content.includes("готово"));
    expect(hits.length).toBe(1);
  });

  it("applies entityType + profileIds filters", async () => {
    const pid = randomUUID();
    await db.insert(embeddings).values({
      entityType: "task",
      entityId: randomUUID(),
      content: "Проверить рабочую почту",
      profileIds: [pid],
      metadata: { tags: ["work"], projectId: null },
    });
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/search`,
      payload: { query: "почту", type: "task", profileIds: [pid] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect((body.results as any[]).every((r) => r.type === "task")).toBe(true);
  });

  it("filters by tags stored in metadata", async () => {
    await db.insert(embeddings).values({
      entityType: "note",
      entityId: randomUUID(),
      content: "Заметка про отпуск",
      profileIds: [],
      metadata: { tags: ["vacation"], projectId: null },
    });
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/search`,
      payload: { query: "отпуск", tags: ["vacation"] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().results as any[]).some((r) => r.content.includes("отпуск"))).toBe(true);
  });

  it("semantic=false and graceful results when Ollama is unreachable", async () => {
    const prev = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = "http://127.0.0.1:9"; // connection refused
    try {
      const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "молоко", type: "note" } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.semantic).toBe(false);
      expect(body.results.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.OLLAMA_URL = prev;
    }
  });

  it("respects limit/offset pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await db.insert(embeddings).values({
        entityType: "note",
        entityId: randomUUID(),
        content: `pagination row ${i} unique-token`,
        profileIds: [],
      });
    }
    const page1 = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "unique-token", limit: 2, offset: 0 } });
    const page2 = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "unique-token", limit: 2, offset: 2 } });
    const p1 = page1.json();
    const p2 = page2.json();
    expect(p1.results.length).toBe(2);
    expect(p2.results.length).toBe(2);
    expect(p1.total).toBe(5);
    const ids1 = new Set((p1.results as any[]).map((r) => r.id));
    const ids2 = new Set((p2.results as any[]).map((r) => r.id));
    expect([...ids1].every((id) => !ids2.has(id))).toBe(true);
  });

  it("upsertEmbedding is idempotent (same entity upserts, no duplicates)", async () => {
    const entityId = randomUUID();
    await upsertEmbedding({ entityType: "note", entityId, content: "первый контент", profileIds: [] });
    await upsertEmbedding({ entityType: "note", entityId, content: "обновлённый контент", profileIds: [] });
    const rows = await db.select().from(embeddings).where(eq(embeddings.entityId, entityId));
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe("обновлённый контент");
  });

  it("indexes a real pmos.notes.notes.created event via NATS (saga wiring)", async () => {
    if (!HAS_NATS) return;
    const bus = EventBus.get();
    const noteId = randomUUID();
    await bus.publish("pmos.notes.notes.created", {
      id: noteId,
      title: "Сага заметка",
      bodyMd: "создана по событию",
      tags: [],
      profileIds: [],
      linkedProjectId: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 700));
    const rows = await db.select().from(embeddings).where(eq(embeddings.entityId, noteId));
    expect(rows.length).toBe(1);
    expect(rows[0].entityType).toBe("note");
    expect(rows[0].content).toContain("Сага заметка");
  });
});
