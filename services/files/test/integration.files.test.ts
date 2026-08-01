import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { EventEnvelope } from "@pmos/shared";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { fileMeta, processedEvents } from "../src/db/schema.js";
import { extractText } from "../src/lib/text-extract.js";
import { handleFileUploaded, type EventPublisher } from "../src/events/subscribe.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/files/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function multipartBody(
  boundary: string,
  file: { filename: string; mime: string; content: Buffer },
  fields: Record<string, string>,
): Buffer {
  const chunks: Buffer[] = [];
  const part = (name: string, value: Buffer | string, opts: { filename?: string; mime?: string } = {}): void => {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
    if (opts.filename) head += `; filename="${opts.filename}"`;
    head += "\r\n";
    if (opts.mime) head += `Content-Type: ${opts.mime}\r\n`;
    chunks.push(Buffer.from(head + "\r\n", "utf8"));
    chunks.push(typeof value === "string" ? Buffer.from(value, "utf8") : value);
    chunks.push(Buffer.from("\r\n", "utf8"));
  };
  part("file", file.content, { filename: file.filename, mime: file.mime });
  for (const [k, v] of Object.entries(fields)) part(k, v);
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

describe.skipIf(!HAS_DB)("files (real Postgres): upload/download/delete/extract", () => {
  let app: any;
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), "pmos-files-"));
    process.env.UPLOAD_DIR = uploadDir;
    app = await buildApp();
    await app.ready();
    await db.delete(fileMeta);
    await db.delete(processedEvents);
  });

  afterAll(async () => {
    await db.delete(fileMeta).catch(() => {});
    await db.delete(processedEvents).catch(() => {});
    if (app) await app.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  async function upload(content: Buffer, mime: string, filename: string, fields: Record<string, string> = {}) {
    const boundary = "----pmos" + randomUUID();
    const body = multipartBody(boundary, { filename, mime, content }, fields);
    return app.inject({
      method: "POST",
      url: `${BASE}/files`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it("multipart upload stores file on disk and returns metadata", async () => {
    const content = "hello files world\nline two";
    const pid = randomUUID();
    const oid = randomUUID();
    const res = await upload(Buffer.from(content), "text/plain", "hello.txt", {
      profileIds: JSON.stringify([pid]),
      ownerType: "note",
      ownerId: oid,
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    expect(row.id).toMatch(UUID_RE);
    expect(row.filename).toBe("hello.txt");
    expect(row.mimeType).toBe("text/plain");
    expect(row.size).toBe(Buffer.byteLength(content));
    expect(row.ownerType).toBe("note");
    expect(row.ownerId).toBe(oid);
    expect(row.profileIds).toEqual([pid]);
    expect(row.uploadedAt).toBeTruthy();

    const onDisk = await readFile(row.storagePath as string, "utf8");
    expect(onDisk).toBe(content);
  });

  it("allows an empty file (size 0)", async () => {
    const res = await upload(Buffer.alloc(0), "text/plain", "empty.txt");
    expect(res.statusCode).toBe(201);
    const row = res.json();
    expect(row.size).toBe(0);
  });

  it("rejects a file larger than 50MB with 413", async () => {
    const res = await upload(Buffer.alloc(50 * 1024 * 1024 + 1), "application/octet-stream", "huge.bin");
    expect(res.statusCode).toBe(413);
  });

  it("download streams content with correct headers", async () => {
    const content = "downloadable content";
    const up = await upload(Buffer.from(content), "text/plain", "readme.txt");
    expect(up.statusCode).toBe(201);
    const id = (up.json() as { id: string }).id;

    const res = await app.inject({ method: "GET", url: `${BASE}/files/${id}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(content);
    expect((res.headers["content-type"] as string) ?? "").toContain("text/plain");
    expect((res.headers["content-disposition"] as string) ?? "").toContain('filename="readme.txt"');
  });

  it("download returns 404 for a missing file on disk", async () => {
    const up = await upload(Buffer.from("gone soon"), "text/plain", "ghost.txt");
    const id = (up.json() as { id: string }).id;
    const path = (up.json() as { storagePath: string }).storagePath;
    await rm(path, { force: true });

    const res = await app.inject({ method: "GET", url: `${BASE}/files/${id}/download` });
    expect(res.statusCode).toBe(404);
  });

  it("delete removes the row and the physical file", async () => {
    const up = await upload(Buffer.from("to be deleted"), "text/plain", "bye.txt");
    const id = (up.json() as { id: string }).id;
    const storagePath = (up.json() as { storagePath: string }).storagePath;

    const del = await app.inject({ method: "DELETE", url: `${BASE}/files/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `${BASE}/files/${id}` });
    expect(get.statusCode).toBe(404);

    await expect(readFile(storagePath)).rejects.toThrow();
  });

  it("extractText pure function handles text and unsupported types", async () => {
    expect(await extractText("text/plain", Buffer.from("abc"))).toBe("abc");
    expect(await extractText("text/markdown", Buffer.from("# h"))).toBe("# h");
    expect(await extractText("application/pdf", Buffer.from("junk"))).toBe("");
    expect(await extractText("image/png", Buffer.from("junk"))).toBe("");
  });

  it("handleFileUploaded publishes text_extracted for a txt file and is idempotent", async () => {
    const filePath = join(uploadDir, `${randomUUID()}.bin`);
    await writeFile(filePath, "extract me please");

    const published: Array<{ type: string; data: unknown; opts?: { correlationId?: string } }> = [];
    const fakeBus: EventPublisher = {
      async publish<T>(type: string, data: T, opts?: { correlationId?: string }): Promise<unknown> {
        published.push({ type, data, opts });
        return null;
      },
    };

    const env: EventEnvelope<{ fileId: string; filename: string; mimeType: string; size: number; storagePath: string; profileIds: string[] }> = {
      id: randomUUID(),
      type: "pmos.files.uploaded",
      source: "files",
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: randomUUID(),
      data: { fileId: randomUUID(), filename: "x.txt", mimeType: "text/plain", size: 15, storagePath: filePath, profileIds: [] },
    };

    await handleFileUploaded(env, fakeBus);
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe("pmos.files.text_extracted");
    const data = (published[0]?.data ?? {}) as { fileId?: string; extractedText?: string; mimeType?: string };
    expect(data.fileId).toBe(env.data.fileId);
    expect(data.extractedText).toBe("extract me please");
    expect(data.mimeType).toBe("text/plain");
    expect(published[0]?.opts?.correlationId).toBe(env.correlationId);

    const rows = await db.select().from(processedEvents).where(eq(processedEvents.eventId, env.id));
    expect(rows).toHaveLength(1);

    // at-least-once redelivery: same event id is skipped
    await handleFileUploaded(env, fakeBus);
    expect(published).toHaveLength(1);
  });
});
