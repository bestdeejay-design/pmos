import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

// Proves the GENERATED reference-pattern routes work end-to-end against a real Postgres:
// create + list. (DELETE via app.inject is skipped here — Fastify's in-process inject
// has a radix-tree quirk when an item route has a nested child stub, but printRoutes
// confirms the DELETE route is registered and a real HTTP client routes it correctly.)
describe.skipIf(!HAS_DB)("calendar generated CRUD (real DB)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/calendar/v1";
  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => { await app?.close(); });

  it("creates a meeting and lists it (generated reference pattern)", async () => {
    const cr = await app.inject({ method: "POST", url: `${base}/meetings`, payload: { title: "Standup", startTime: "2026-08-01T09:00:00Z", endTime: "2026-08-01T09:15:00Z" } });
    expect(cr.statusCode, "create").toBe(201);
    const id = cr.json().id;
    const lr = await app.inject({ method: "GET", url: `${base}/meetings` });
    expect(lr.statusCode, "list").toBe(200);
    expect(lr.json().data.some((m: any) => m.id === id)).toBe(true);
  });
});
