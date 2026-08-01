import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { scanFolder, readFileContent } from "../lib/scanner.js";

function emit(subject: string, data: unknown, correlationId?: string): void {
  try {
    EventBus.get().publish(subject, data, correlationId ? { correlationId } : undefined).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

async function runScan(folderId: string, folderPath: string, correlationId?: string): Promise<void> {
  try {
    const { imported, files } = await scanFolder(folderPath);
    for (const rel of files) {
      const contentMd = await readFileContent(folderPath, rel);
      await db.insert(schema.scannedFiles)
        .values({ folderId, relativePath: rel, contentMd })
        .onConflictDoUpdate({
          target: [schema.scannedFiles.folderId, schema.scannedFiles.relativePath],
          set: { contentMd },
        });
    }
    await db.update(schema.syncFolders)
      .set({ lastScanAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.syncFolders.id, folderId));
    emit("pmos.sync.folder_scanned", { folderId, imported, correlationId }, correlationId);
  } catch (err) {
    console.error(`[sync] scan folder ${folderId} failed:`, err);
  }
}

function scheduleScan(folderId: string, folderPath: string, correlationId?: string): void {
  setTimeout(() => { void runScan(folderId, folderPath, correlationId); }, 0);
}

export const syncRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "sync" }));

  // ───────────── sync-folders CRUD (reference pattern) ─────────────
  typed.get("/sync-folders", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
    const rows = await db.select().from(schema.syncFolders)
      .orderBy(asc(schema.syncFolders.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.syncFolders);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/sync-folders", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const [row] = await db.insert(schema.syncFolders).values(req.body as any).returning();
    if (!row) return fail(500, "INTERNAL_ERROR", "insert failed");
    emit("pmos.sync.sync-folders.created", row);
    if (row.autoImport !== false) {
      scheduleScan(row.id, row.path, correlationId);
    }
    return reply.code(201).send(row);
  });

  typed.get("/sync-folders/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.syncFolders).where(eq(schema.syncFolders.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "sync-folders not found");
    return reply.send(row);
  });

  typed.patch("/sync-folders/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const patch: any = { ...(req.body as any) };
    patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.syncFolders).set(patch)
      .where(eq(schema.syncFolders.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "sync-folders not found");
    emit("pmos.sync.sync-folders.updated", row);
    const rescan = patch.path !== undefined || patch.autoImport !== undefined;
    if (rescan && row.autoImport !== false) {
      scheduleScan(row.id, row.path, correlationId);
    }
    return reply.send(row);
  });

  typed.delete("/sync-folders/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.syncFolders)
      .where(eq(schema.syncFolders.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "sync-folders not found");
    await db.delete(schema.scannedFiles).where(eq(schema.scannedFiles.folderId, row.id));
    await db.delete(schema.syncFolders).where(eq(schema.syncFolders.id, row.id));
    emit("pmos.sync.sync-folders.deleted", row);
    return reply.code(204).send();
  });

  // ───────────── scanned files ─────────────
  typed.get("/sync-folders/files", {
    schema: {
      querystring: Type.Object({ folderId: Type.String({ format: "uuid" }) }),
      response: { 200: Type.Object({ data: Type.Array(Type.Any()) }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const rows = await db.select().from(schema.scannedFiles)
      .where(eq(schema.scannedFiles.folderId, q.folderId))
      .orderBy(asc(schema.scannedFiles.relativePath));
    return reply.send({ data: rows });
  });
};
