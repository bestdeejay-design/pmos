import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { notes } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/notes/v1";

describe.skipIf(!HAS_DB)("notes (real Postgres): search + manual order", () => {
  let app: any;
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(notes); // isolate test data
  });

  afterAll(async () => {
    await db.delete(notes).where; // best-effort cleanup
    if (app) await app.close();
  });

  it("creates a note and finds it via ILIKE search", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/notes`,
      payload: { title: "Project Alpha kickoff", bodyMd: "Decide on the roadmap and milestones" },
    });
    expect(r.statusCode).toBe(201);
    const id = (r.json() as any).id;
    created.push(id);

    const found = await app.inject({ method: "GET", url: `${BASE}/notes?q=roadmap` });
    expect(found.statusCode).toBe(200);
    const body = found.json() as any;
    expect(body.data.some((n: any) => n.id === id)).toBe(true);
  });

  it("manual reorder persists (PUT /notes/order)", async () => {
    const a = await app.inject({ method: "POST", url: `${BASE}/notes`, payload: { title: "A" } });
    const b = await app.inject({ method: "POST", url: `${BASE}/notes`, payload: { title: "B" } });
    const aid = (a.json() as any).id;
    const bid = (b.json() as any).id;
    created.push(aid, bid);

    const reorder = await app.inject({
      method: "PUT",
      url: `${BASE}/notes/order`,
      payload: { order: [bid, aid] }, // B before A
    });
    expect(reorder.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: `${BASE}/notes` });
    const data = (list.json() as any).data as any[];
    const posA = data.findIndex((n) => n.id === aid);
    const posB = data.findIndex((n) => n.id === bid);
    expect(posB).toBeLessThan(posA);
  });

  it("generate-title returns a heuristic title+tag", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/notes/generate-title`,
      payload: { bodyMd: "Meeting with #client about the Q3 budget" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as any;
    expect(body.tag).toBe("client");
    expect(typeof body.title).toBe("string");
  });
});
