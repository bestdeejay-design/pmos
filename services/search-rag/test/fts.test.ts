import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-test DB state shared with the mocked connection module below.
const mockState = vi.hoisted(() => ({
  rows: [] as any[], // ILIKE / semantic slice rows
  ftsRows: [] as any[], // FTS slice rows (carry rank + snippet)
  total: 0,
  ftsThrows: false,
}));

vi.mock("../src/db/connection.js", () => {
  const resolveFor = (sel: any) => {
    if (mockState.ftsThrows && sel && "rank" in sel) throw new Error("fts parse failed");
    if (sel && "total" in sel) return [{ total: mockState.total }];
    if (sel && "rank" in sel) return mockState.ftsRows;
    return mockState.rows;
  };
  const makeBuilder = (sel: any) => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: async () => resolveFor(sel),
      then: (onF: any, onR: any) => Promise.resolve(resolveFor(sel)).then(onF, onR),
    };
    return builder;
  };
  return { db: { select: (sel?: any) => makeBuilder(sel) } };
});

vi.mock("../src/lib/embed.js", () => ({
  embed: vi.fn(async () => null),
}));

vi.mock("@pmos/event-bus", () => ({
  EventBus: {
    init: vi.fn(),
    get: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      ensureStream: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn(() => true),
    })),
  },
}));

import { buildApp } from "../src/app.js";
import { embed } from "../src/lib/embed.js";

const BASE = "/api/search-rag/v1";

describe("POST /search — full-text (tsvector/GIN) slice", () => {
  let app: any;

  beforeEach(() => {
    mockState.rows = [];
    mockState.ftsRows = [];
    mockState.total = 0;
    mockState.ftsThrows = false;
    vi.mocked(embed).mockResolvedValue(null as never);
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("ranks FTS hits and attaches rank + snippet + highlights when FTS yields results", async () => {
    mockState.ftsRows = [{
      id: "11111111-1111-1111-1111-111111111111",
      entityType: "note",
      entityId: "22222222-2222-2222-2222-222222222222",
      content: "Нужно купить молоко и хлеб",
      profileIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      rank: 0.0607927,
      snippet: "Нужно купить <mark>молоко</mark> и хлеб",
    }];
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "молоко" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.semantic).toBe(false);
    expect(body.results).toHaveLength(1);
    const hit = body.results[0];
    expect(hit.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(hit.rank).toBeCloseTo(0.0607927);
    expect(hit.snippet).toContain("<mark>молоко</mark>");
    expect(hit.highlights).toEqual(["молоко"]);
    // existing public fields preserved
    expect(hit.content).toBe("Нужно купить молоко и хлеб");
  });

  it("extracts plain-text highlights from the ts_headline snippet", async () => {
    mockState.ftsRows = [{
      id: "33333333-3333-3333-3333-333333333333",
      entityType: "task",
      entityId: "44444444-4444-4444-4444-444444444444",
      content: "Проверить рабочую почту и встречу",
      profileIds: [],
      createdAt: "2026-01-02T00:00:00.000Z",
      rank: 0.25,
      snippet: "Проверить рабочую <mark>почту</mark> и <mark>встречу</mark>",
    }];
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "почту встречу" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[0].snippet.length).toBeGreaterThan(0);
    expect(body.results[0].highlights).toEqual(["почту", "встречу"]);
  });

  it("returns [] with 200 for an empty query (no crash)", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.semantic).toBe(false);
  });

  it("falls back to ILIKE results when tsquery parsing throws on unusual input (!)", async () => {
    mockState.ftsThrows = true;
    mockState.rows = [{
      id: "55555555-5555-5555-5555-555555555555",
      entityType: "note",
      entityId: "66666666-6666-6666-6666-666666666666",
      content: "100% готово",
      profileIds: [],
      createdAt: "2026-01-03T00:00:00.000Z",
    }];
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "!" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.semantic).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("55555555-5555-5555-5555-555555555555");
    expect(body.results[0].rank).toBeUndefined();
    expect(body.results[0].snippet).toBeUndefined();
    expect(body.results[0].highlights).toBeUndefined();
  });

  it("does not crash on a bare asterisk query (*)", async () => {
    mockState.ftsThrows = true;
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${BASE}/search`, payload: { query: "*" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});
