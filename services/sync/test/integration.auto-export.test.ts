import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { syncFolders } from "../src/db/schema.js";
import { handleNoteEvent } from "../src/events/subscribe.js";
import type { EventEnvelope } from "@pmos/shared";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/sync/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envelope(type: string, data: Record<string, unknown>): EventEnvelope<Record<string, unknown>> {
  return {
    id: randomUUID(),
    type,
    source: "notes",
    timestamp: new Date().toISOString(),
    version: 1,
    correlationId: randomUUID(),
    data,
  };
}

describe.skipIf(!HAS_DB)("sync (real Postgres): auto-export notes -> .md on disk", () => {
  let app: any;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pmos-sync-export-"));
    app = await buildApp();
    await app.ready();
    await db.delete(syncFolders);
  });

  afterAll(async () => {
    await db.delete(syncFolders).catch(() => {});
    if (app) await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("notes.created with autoExport folder writes <noteId>.md with frontmatter + body", async () => {
    const folder = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: false, autoExport: true, profileScope: "[]" },
    });
    expect(folder.statusCode).toBe(201);
    const folderId = folder.json().id;
    expect(folderId).toMatch(UUID_RE);

    const noteId = randomUUID();
    await handleNoteEvent(envelope("pmos.notes.notes.created", {
      id: noteId, title: "Quarterly Goals", bodyMd: "# Q1", tags: ["work", "plan"],
    }));

    const file = join(tmpDir, `${noteId}.md`);
    const content = await readFile(file, "utf8");
    expect(content).toContain('title: "Quarterly Goals"');
    expect(content).toContain('tags: ["work", "plan"]');
    expect(content).toContain("# Q1");

    // No auto-export folder configured with autoExport=false -> nothing written.
    await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${folderId}` });
  });

  it("notes.updated overwrites the same .md file idempotently", async () => {
    await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: false, autoExport: true, profileScope: "[]" },
    });
    const noteId = randomUUID();
    const ev = () => envelope("pmos.notes.notes.updated", { id: noteId, title: "V1", bodyMd: "one" });

    await handleNoteEvent(ev());
    const first = join(tmpDir, `${noteId}.md`);
    expect(await readFile(first, "utf8")).toContain("one");

    await handleNoteEvent(ev()); // duplicate delivery (at-least-once)
    expect(await readFile(first, "utf8")).toContain("one");
  });

  it("notes.deleted removes the exported .md file", async () => {
    await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: false, autoExport: true, profileScope: "[]" },
    });
    const noteId = randomUUID();
    await handleNoteEvent(envelope("pmos.notes.notes.deleted", { id: noteId, isArchived: true }));

    await sleep(50);
    await expect(access(join(tmpDir, `${noteId}.md`))).rejects.toThrow();
  });
});