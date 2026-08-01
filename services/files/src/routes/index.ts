import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import multipart, { type Multipart } from "@fastify/multipart";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { MAX_FILE_SIZE, ensureUploadDir, deleteStoredFile } from "../lib/storage.js";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function emitUploaded(row: schema.FileMetaRow, correlationId?: string): void {
  try {
    EventBus.get().publish("pmos.files.uploaded", {
      fileId: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      storagePath: row.storagePath,
      profileIds: row.profileIds,
    }, { correlationId }).catch((e) => console.error("[event] publish pmos.files.uploaded failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

// The TypeBox type-provider in this workspace can't infer route params
// (@sinclair/typebox 0.34 vs the provider's 0.26–0.33 peer range), so params
// arrive as unknown. A narrow structural cast keeps handlers type-safe.
type IdParams = { id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Multipart text-field value (single occurrence). */
function fieldString(f: Multipart | Multipart[] | undefined): string | undefined {
  const single = Array.isArray(f) ? f[0] : f;
  if (!single || single.type !== "field") return undefined;
  return typeof single.value === "string" ? single.value : undefined;
}

/** profileIds arrives as a JSON-encoded array string, e.g. '["uuid1","uuid2"]'. */
function parseProfileIds(f: Multipart | Multipart[] | undefined): string[] {
  const raw = fieldString(f);
  if (raw === undefined || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && UUID_RE.test(x));
  } catch {
    return [];
  }
}

// columns present on the backing table (used to guard optional order-by)
const tableCols = new Set<string>(["id", "filename", "mimeType", "size", "ownerType", "ownerId", "storagePath", "profileIds", "uploadedAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const filesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "files" }));

  // ───────────── files CRUD ─────────────
  typed.get("/files", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        profileId: Type.Optional(Type.String()),
        ownerType: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Object({
        data: Type.Array(Type.Any()),
        pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
      }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const conds: any[] = [];

    if (q.profileId !== undefined) conds.push(sql`${schema.fileMeta.profileIds} @> ARRAY[${q.profileId}]::uuid[]`);
    if (q.ownerType !== undefined) conds.push(eq(schema.fileMeta.ownerType, q.ownerType));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.fileMeta).where(where)
      .orderBy(asc(schema.fileMeta.id)).limit(limit).offset(offset);
    const total = await totalOf(schema.fileMeta, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  // Multipart upload: file part + profileIds (JSON string) / ownerType / ownerId fields.
  typed.post("/files", {
    schema: { response: { 201: Type.Any(), 400: Type.Any(), 413: Type.Any() } },
  }, async (req, reply) => {
    let data;
    try {
      data = await req.file();
    } catch (e) {
      const status = e instanceof Error && "statusCode" in e ? (e as { statusCode?: number }).statusCode : undefined;
      if (status === 413) return fail(413, "FILE_TOO_LARGE", "file exceeds 50MB limit");
      return fail(400, "VALIDATION_ERROR", "multipart request with a 'file' part is required");
    }
    if (!data) return fail(400, "VALIDATION_ERROR", "multipart request with a 'file' part is required");

    const buffer = await data.toBuffer().catch(() => null);
    if (buffer === null) return fail(413, "FILE_TOO_LARGE", "file exceeds 50MB limit");

    const filename = data.filename || "file";
    const mimeType = data.mimetype || "application/octet-stream";
    const profileIds = parseProfileIds(data.fields.profileIds);
    const ownerType = fieldString(data.fields.ownerType);
    const ownerIdRaw = fieldString(data.fields.ownerId);
    const ownerId = ownerIdRaw && UUID_RE.test(ownerIdRaw) ? ownerIdRaw : null;

    const id = randomUUID();
    const dir = await ensureUploadDir();
    const storagePath = path.join(dir, `${id}.bin`);
    await writeFile(storagePath, buffer);

    let rows;
    try {
      rows = await db.insert(schema.fileMeta).values({
        id, filename, mimeType, size: buffer.byteLength,
        ownerType: ownerType ?? null, ownerId, storagePath, profileIds,
        uploadedAt: new Date().toISOString(),
      }).returning();
    } catch (e) {
      await deleteStoredFile(storagePath);
      throw e;
    }
    const row = rows[0];
    if (!row) {
      await deleteStoredFile(storagePath);
      return fail(500, "INTERNAL_ERROR", "failed to insert file_meta");
    }

    const correlationId = (req.headers["x-correlation-id"] as string) || undefined;
    emitUploaded(row, correlationId);
    return reply.code(201).send(row);
  });

  typed.get("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as IdParams).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "files not found");
    return reply.send(row);
  });

  typed.patch("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.fileMeta).set(patch)
      .where(eq(schema.fileMeta.id, (req.params as IdParams).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "files not found");
    emit("pmos.files.files.updated", row);
    return reply.send(row);
  });

  typed.delete("/files/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as IdParams).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "files not found");
    await deleteStoredFile(row.storagePath);
    emit("pmos.files.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── download ─────────────
  typed.get("/files/:id/download", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as IdParams).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "files not found");
    try {
      await access(row.storagePath);
    } catch {
      return fail(404, "NOT_FOUND", "files not found");
    }
    const safeName = row.filename.replace(/["\\\r\n]/g, "_");
    reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
    reply.type(row.mimeType || "application/octet-stream");
    return reply.send(createReadStream(row.storagePath));
  });
};
