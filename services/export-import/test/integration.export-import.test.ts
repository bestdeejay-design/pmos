import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { exportStore, importItems, exportJobs } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/export-import/v1";

describe.skipIf(!HAS_DB)("export-import (real Postgres): export zip/json + import text/json", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(importItems);
    await db.delete(exportJobs);
    await db.delete(exportStore);
    await db.insert(exportStore).values([
      { entityType: "notes", entityId: "note-1", payload: { id: "note-1", title: "Alpha" } },
      { entityType: "notes", entityId: "note-2", payload: { id: "note-2", title: "Beta" } },
      { entityType: "meetings", entityId: "meeting-1", payload: { id: "meeting-1", title: "Standup" } },
    ]);
  });

  afterAll(async () => {
    await db.delete(importItems);
    await db.delete(exportJobs);
    await db.delete(exportStore);
    if (app) await app.close();
  });

  it("GET /export?format=json returns manifest + per-type arrays", async () => {
    const r = await app.inject({ method: "GET", url: `${BASE}/export?format=json` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    const body = r.json();
    expect(body.manifest.counts).toEqual({ notes: 2, meetings: 1 });
    expect(body.notes.length).toBe(2);
    expect(body.meetings.length).toBe(1);
  });

  it("GET /export (zip) returns an application/zip archive with manifest.json", async () => {
    const r = await app.inject({ method: "GET", url: `${BASE}/export` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/zip");
    expect(r.headers["content-disposition"]).toContain("attachment");
    // ZIP magic bytes: PK\x03\x04
    expect(r.rawPayload.length).toBeGreaterThan(0);
    const buf = r.rawPayload as Buffer;
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("POST /import (text) creates an import_item and returns 201", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/import`,
      payload: { format: "text", content: "Draft import text", title: "From import" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeTypeOf("string");
    expect(body.status).toBe("imported");
  });

  it("POST /import (json array) imports items and returns counts", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/import`,
      payload: {
        format: "json",
        content: JSON.stringify([
          { type: "note", title: "N1", content: "body one" },
          { type: "task", title: "T1", content: "todo" },
        ]),
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.imported).toBe(2);
    expect(body.items.length).toBe(2);
  });

  it("POST /import (json object {notes:[...]}) is accepted", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/import`,
      payload: { format: "json", content: JSON.stringify({ notes: [{ title: "Only title" }] }) },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().imported).toBe(1);
  });

  it("POST /import with invalid JSON returns 422", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/import`,
      payload: { format: "json", content: "{not json" },
    });
    expect(r.statusCode).toBe(422);
  });
});
