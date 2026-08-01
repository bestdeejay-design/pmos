import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { buildZip } from "../lib/zip.js";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

export const export_importRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "export-import" }));

  // ───────────── export all (ZIP) ─────────────
  typed.get("/export", {
    schema: {
      querystring: Type.Object({
        format: Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    const q = req.query as { format?: string };
    const format = q.format ?? "zip";

    const rows = await db.select().from(schema.exportStore).orderBy(asc(schema.exportStore.createdAt));
    const counts: Record<string, number> = {};
    const byType: Record<string, unknown[]> = {};
    for (const row of rows) {
      counts[row.entityType] = (counts[row.entityType] ?? 0) + 1;
      (byType[row.entityType] ??= []).push(row.payload ?? { id: row.entityId });
    }
    const manifest = { exportedAt: new Date().toISOString(), service: "export-import", counts };

    if (format === "json") {
      const body = { manifest, ...byType };
      await recordExportJob(JSON.stringify(body).length);
      return reply.header("Content-Type", "application/json").send(body);
    }

    const files: Record<string, string> = { "manifest.json": JSON.stringify(manifest, null, 2) };
    for (const [entityType, items] of Object.entries(byType)) {
      files[`${entityType}.json`] = JSON.stringify(items, null, 2);
    }

    try {
      const zip = buildZip(files);
      await recordExportJob(zip.length);
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="pmos-export-${new Date().toISOString().slice(0, 10)}.zip"`)
        .send(zip);
    } catch (err) {
      // archiver-independent fallback: plain JSON object (application/json)
      console.error("[export] zip build failed, falling back to json:", err);
      const body = { manifest, ...byType };
      await recordExportJob(JSON.stringify(body).length);
      return reply.header("Content-Type", "application/json").send(body);
    }
  });

  // ───────────── import ─────────────
  typed.post("/import", {
    schema: {
      body: Type.Object({
        format: Type.String(),
        content: Type.String(),
        title: Type.Optional(Type.String()),
      }, { additionalProperties: true }),
    },
  }, async (req, reply) => {
    const { format, content, title } = req.body as { format: string; content: string; title?: string };

    if (format === "text") {
      // Text import: treat content as a note body → durable import_items row.
      const [row] = await db.insert(schema.importItems)
        .values({ kind: "note", title: title ?? null, content }).returning();
      if (!row) return fail(500, "INTERNAL_ERROR", "failed to create import item");
      emit("pmos.export-import.import.imported", row);
      return reply.code(201).send({ id: row.id, status: row.status });
    }

    if (format !== "json") {
      return fail(400, "VALIDATION_ERROR", "format must be 'text' or 'json'");
    }

    // JSON import: accept an array of {type, title?, content?} or {notes: [...]}.
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return fail(422, "VALIDATION_ERROR", "invalid JSON");
    }

    let entries: unknown[];
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).notes)) {
      entries = (parsed as Record<string, unknown>).notes as unknown[];
    } else {
      entries = [];
    }

    const items: Array<{ id: string; kind: string; title: string | null; status: string }> = [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") {
        return fail(422, "VALIDATION_ERROR", "invalid entry: not an object");
      }
      const obj = entry as Record<string, unknown>;
      if (typeof obj.title !== "string" && typeof obj.content !== "string") {
        return fail(422, "VALIDATION_ERROR", "invalid entry: missing title/content");
      }
      const kind = typeof obj.type === "string" ? obj.type : "note";
      const itemTitle = typeof obj.title === "string" ? obj.title : null;
      const itemContent = typeof obj.content === "string" ? obj.content : "";
      const [row] = await db.insert(schema.importItems)
        .values({ kind, title: itemTitle, content: itemContent }).returning();
      if (row) items.push({ id: row.id, kind: row.kind, title: row.title, status: row.status });
    }

    emit("pmos.export-import.import.imported", { count: items.length });
    return reply.send({ imported: items.length, items });
  });
};

async function recordExportJob(size: number): Promise<void> {
  try {
    await db.insert(schema.exportJobs).values({ kind: "export", status: "completed", size });
  } catch (err) {
    console.error("[export] failed to record export job:", err);
  }
}
