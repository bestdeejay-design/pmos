import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { syncFolders, scannedFiles } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/sync/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!HAS_DB)("sync (real Postgres): folder scan + auto-import", () => {
  let app: any;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pmos-sync-"));
    app = await buildApp();
    await app.ready();
    await db.delete(scannedFiles);
    await db.delete(syncFolders);
  });

  afterAll(async () => {
    await db.delete(scannedFiles).catch(() => {});
    await db.delete(syncFolders).catch(() => {});
    if (app) await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creating a sync-folder scans .md files into scanned_files", async () => {
    await mkdir(join(tmpDir, "sub"), { recursive: true });
    await writeFile(join(tmpDir, "alpha.md"), "# Alpha\n\ncontent");
    await writeFile(join(tmpDir, "sub", "beta.md"), "# Beta");
    await writeFile(join(tmpDir, "skip.txt"), "not markdown");

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: true, autoExport: false, profileScope: "[]" },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    expect(row.id).toMatch(UUID_RE);

    await sleep(500); // scan is scheduled asynchronously

    const files = await db.select().from(scannedFiles).where(eq(scannedFiles.folderId, row.id));
    expect(files).toHaveLength(2);
    const names = files.map((f) => f.relativePath).sort();
    expect(names).toEqual(["alpha.md", "sub/beta.md"]);
    const alpha = files.find((f) => f.relativePath === "alpha.md");
    expect(alpha?.contentMd).toContain("# Alpha");

    const [folder] = await db.select().from(syncFolders).where(eq(syncFolders.id, row.id)).limit(1);
    expect(folder?.lastScanAt).toBeTruthy();

    // delete cascades scanned_files rows
    const del = await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${row.id}` });
    expect(del.statusCode).toBe(204);
    const after = await db.select().from(scannedFiles).where(eq(scannedFiles.folderId, row.id));
    expect(after).toHaveLength(0);
  });

  it("creating a sync-folder with autoImport=false does not scan", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: false },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();

    await sleep(300);
    const files = await db.select().from(scannedFiles).where(eq(scannedFiles.folderId, row.id));
    expect(files).toHaveLength(0);

    await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${row.id}` });
  });

  it("PATCH enabling autoImport triggers a scan", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: false },
    });
    const row = res.json();

    const patched = await app.inject({
      method: "PATCH",
      url: `${BASE}/sync-folders/${row.id}`,
      payload: { autoImport: true },
    });
    expect(patched.statusCode).toBe(200);

    await sleep(500);
    const files = await db.select().from(scannedFiles).where(eq(scannedFiles.folderId, row.id));
    expect(files.length).toBeGreaterThan(0);

    await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${row.id}` });
  });

  it("GET /sync-folders/files lists scanned files for a folder", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: true },
    });
    const row = res.json();
    await sleep(500);

    const list = await app.inject({ method: "GET", url: `${BASE}/sync-folders/files?folderId=${row.id}` });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThan(0);

    await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${row.id}` });
  });

  it("delete of an unknown sync-folder returns 404", async () => {
    const res = await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });

  it("§16.3 a file larger than 512 KB is scanned with empty content", async () => {
    const bigPath = join(tmpDir, "huge.md");
    const bigContent = "x".repeat(600 * 1024);
    await writeFile(bigPath, bigContent);

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/sync-folders`,
      payload: { path: tmpDir, autoImport: true },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    await sleep(500);

    const files = await db.select().from(scannedFiles).where(eq(scannedFiles.folderId, row.id));
    const huge = files.find((f) => f.relativePath === "huge.md");
    expect(huge).toBeTruthy();
    expect(huge?.contentMd).toBe("");

    await app.inject({ method: "DELETE", url: `${BASE}/sync-folders/${row.id}` });
    await rm(bigPath, { force: true });
  });
});
