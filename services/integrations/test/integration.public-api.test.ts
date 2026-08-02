import { describe, it, beforeAll, afterAll, expect } from "vitest";
import http from "node:http";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { apiKeys } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const ADMIN = "/api/integrations/v1/api-keys";
const PUBLIC = "/api/v1";

/**
 * Public API mirror (FEATURES §13): /api/v1/notes|tasks|projects|calendar/* proxies
 * to an upstream service after authenticating a pk_ Bearer key against api_keys.
 * Upstream base URL is injectable via PUBLIC_UPSTREAM_* env vars, so this test points
 * them at a local mock HTTP server.
 */
describe.skipIf(!HAS_DB)("public API mirror (real Postgres + mock upstream)", () => {
  let app: any;
  let mock: http.Server;
  let mockBase = "";
  let validKey = "";
  let deletedKey = "";
  const neverKey = "pk_" + "0".repeat(64);

  beforeAll(async () => {
    // Local mock upstream that records the request path/query and returns a JSON body.
    mock = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ mirrored: true, url: req.url ?? "", path: req.url?.split("?")[0] ?? "" }));
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", () => resolve()));
    const addr = mock.address();
    mockBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 3000}`;
    process.env.PUBLIC_UPSTREAM_NOTES = mockBase;
    process.env.PUBLIC_UPSTREAM_TASKS = mockBase;

    app = await buildApp();
    await app.ready();
    await db.delete(apiKeys);

    const keyA = await app.inject({ method: "POST", url: ADMIN, payload: { name: "pub-active" } });
    validKey = keyA.json().key;
    const keyB = await app.inject({ method: "POST", url: ADMIN, payload: { name: "pub-deleted" } });
    deletedKey = keyB.json().key;
    const dis = await app.inject({ method: "DELETE", url: `${ADMIN}/${keyB.json().id}` });
    expect(dis.statusCode).toBe(204);
  });

  afterAll(async () => {
    await db.delete(apiKeys);
    if (app) await app.close();
    if (mock) await new Promise((r) => mock.close(r));
    delete process.env.PUBLIC_UPSTREAM_NOTES;
    delete process.env.PUBLIC_UPSTREAM_TASKS;
  });

  it("401 without Authorization header", async () => {
    const r = await app.inject({ method: "GET", url: `${PUBLIC}/notes/123` });
    expect(r.statusCode).toBe(401);
  });

  it("401 with an invalid/unknown key", async () => {
    const r = await app.inject({ method: "GET", url: `${PUBLIC}/notes/123`, headers: { authorization: `Bearer ${neverKey}` } });
    expect(r.statusCode).toBe(401);
  });

  it("401 for a deleted (inactive) key", async () => {
    const r = await app.inject({ method: "GET", url: `${PUBLIC}/tasks/1`, headers: { authorization: `Bearer ${deletedKey}` } });
    expect(r.statusCode).toBe(401);
  });

  it("200 proxies notes path to the mock upstream and preserves resource path + query", async () => {
    const r = await app.inject({
      method: "GET",
      url: `${PUBLIC}/notes/abc-1?limit=5`,
      headers: { authorization: `Bearer ${validKey}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    const body = r.json();
    expect(body.mirrored).toBe(true);
    // Upstream receives /api/notes/v1/notes + /abc-1 + query.
    expect(body.path).toBe("/api/notes/v1/notes/abc-1");
    expect(body.url).toBe("/api/notes/v1/notes/abc-1?limit=5");
  });

  it("200 proxies tasks resource with no trailing resource path", async () => {
    const r = await app.inject({
      method: "GET",
      url: `${PUBLIC}/tasks`,
      headers: { authorization: `Bearer ${validKey}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().path).toBe("/api/tasks/v1/tasks");
  });

  it("401 is rejected before any upstream call (no valid key, mock gets nothing)", async () => {
    // Point upstream at an unreachable port; auth must still gate the request.
    process.env.PUBLIC_UPSTREAM_NOTES = "http://127.0.0.1:9";
    const r = await app.inject({ method: "GET", url: `${PUBLIC}/notes/x`, headers: { authorization: `Bearer ${neverKey}` } });
    expect(r.statusCode).toBe(401);
    process.env.PUBLIC_UPSTREAM_NOTES = mockBase;
  });

  it("502 when upstream is unreachable", async () => {
    process.env.PUBLIC_UPSTREAM_NOTES = "http://127.0.0.1:9";
    const r = await app.inject({ method: "GET", url: `${PUBLIC}/notes/x`, headers: { authorization: `Bearer ${validKey}` } });
    expect(r.statusCode).toBe(502);
    process.env.PUBLIC_UPSTREAM_NOTES = mockBase;
  });
});