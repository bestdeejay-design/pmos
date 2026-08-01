import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { fetchInbox, type ImapMessage } from "../lib/imap.js";

function emit(subject: string, data: unknown, correlationId?: string): void {
  try {
    EventBus.get().publish(subject, data, correlationId ? { correlationId } : undefined).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

// Strip the encrypted password before it leaves the service — the contract
// lists it on ImapAccount, but passwords must never reach HTTP responses.
function sanitizeAccount(row: Record<string, unknown>): Record<string, unknown> {
  const { encryptedPassword: _pw, ...rest } = row;
  return rest;
}

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

// Accept either a plain `password` (encrypted here) or a pre-encrypted
// `encryptedPassword`. Removes the plaintext field before persisting.
function accountSecret(body: Record<string, unknown>): { patch: Record<string, unknown> } {
  const patch: Record<string, unknown> = { ...body };
  if (typeof body.password === "string" && body.password.length > 0) {
    patch.encryptedPassword = encryptSecret(body.password);
  }
  delete patch.password;
  return { patch };
}

function toReceivedAt(dateHeader: string | undefined): string | null {
  if (!dateHeader) return null;
  const d = new Date(dateHeader);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export const emailRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "email" }));

  // ───────────── imap CRUD ─────────────
  typed.get("/imap", {
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
    const rows = await db.select().from(schema.imapAccounts)
      .orderBy(asc(schema.imapAccounts.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.imapAccounts);
    return reply.send({ data: rows.map(sanitizeAccount), pagination: { offset, limit, total } });
  });

  typed.post("/imap", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const { patch } = accountSecret(req.body as Record<string, unknown>);
    const [row] = await db.insert(schema.imapAccounts).values(patch as any).returning();
    if (!row) return fail(500, "INTERNAL_ERROR", "insert failed");
    emit("pmos.email.imap.created", sanitizeAccount(row));
    return reply.code(201).send(sanitizeAccount(row));
  });

  typed.get("/imap/:id", {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.imapAccounts).where(eq(schema.imapAccounts.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "imap not found");
    return reply.send(sanitizeAccount(row));
  });

  typed.patch("/imap/:id", {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const { patch } = accountSecret(req.body as Record<string, unknown>);
    patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.imapAccounts).set(patch as any)
      .where(eq(schema.imapAccounts.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "imap not found");
    emit("pmos.email.imap.updated", sanitizeAccount(row));
    return reply.send(sanitizeAccount(row));
  });

  typed.delete("/imap/:id", {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.imapAccounts).where(eq(schema.imapAccounts.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "imap not found");
    emit("pmos.email.imap.deleted", sanitizeAccount(row));
    return reply.code(204).send();
  });

  // ───────────── sync ─────────────
  typed.post("/imap/:id/sync", {
    schema: {
      params: Type.Object({ id: Type.String() }),
      response: { 200: Type.Object({ synced: Type.Integer() }), 404: Type.Any(), 502: Type.Any() },
    },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const [account] = await db.select().from(schema.imapAccounts)
      .where(eq(schema.imapAccounts.id, (req.params as any).id)).limit(1);
    if (!account) return fail(404, "NOT_FOUND", "imap not found");

    let password: string;
    try {
      password = decryptSecret(account.encryptedPassword);
    } catch (err) {
      req.log?.error?.({ accountId: account.id, err }, "imap sync: password decrypt failed");
      return reply.code(502).send({ code: "IMAP_UNAVAILABLE", message: "stored password cannot be decrypted" });
    }

    let messages: ImapMessage[];
    try {
      messages = await fetchInbox({
        host: account.host,
        port: account.port,
        ssl: account.ssl,
        username: account.username,
        password,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log?.error?.({ accountId: account.id, err }, "imap sync failed");
      return reply.code(502).send({ code: "IMAP_UNAVAILABLE", message });
    }

    let synced = 0;
    for (const msg of messages) {
      const [existing] = await db.select().from(schema.emails)
        .where(and(eq(schema.emails.accountId, account.id), eq(schema.emails.messageId, msg.messageId)))
        .limit(1);
      if (existing) {
        await db.update(schema.emails).set({
          from: msg.from,
          subject: msg.subject,
          body: msg.body || existing.body,
          receivedAt: toReceivedAt(msg.date) ?? existing.receivedAt,
        }).where(eq(schema.emails.id, existing.id));
      } else {
        await db.insert(schema.emails).values({
          accountId: account.id,
          messageId: msg.messageId,
          from: msg.from,
          subject: msg.subject,
          body: msg.body,
          receivedAt: toReceivedAt(msg.date),
        });
      }
      synced += 1;
    }

    await db.update(schema.imapAccounts)
      .set({ lastSyncAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.imapAccounts.id, account.id));

    emit("pmos.email.synced", { accountId: account.id, count: synced, correlationId }, correlationId);
    return reply.send({ synced });
  });

  // ───────────── emails ─────────────
  typed.get("/imap/emails", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        accountId: Type.Optional(Type.String({ format: "uuid" })),
        isArchived: Type.Optional(Type.Boolean()),
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
    if (q.accountId) conds.push(eq(schema.emails.accountId, q.accountId));
    if (typeof q.isArchived === "boolean") conds.push(eq(schema.emails.isArchived, q.isArchived));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.emails).where(where)
      .orderBy(sql`${schema.emails.receivedAt} DESC NULLS LAST`).limit(limit).offset(offset);
    const total = await totalOf(schema.emails, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.patch("/imap/emails", {
    schema: {
      body: Type.Object({
        id: Type.String({ format: "uuid" }),
        isArchived: Type.Optional(Type.Boolean()),
        convertTo: Type.Optional(Type.Union([Type.Literal("note"), Type.Literal("task")])),
      }),
      response: { 200: Type.Object({ ok: Type.Boolean() }), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? undefined;
    const body = req.body as any;
    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, body.id)).limit(1);
    if (!email) return fail(404, "NOT_FOUND", "email not found");

    const patch: Record<string, unknown> = {};
    if (typeof body.isArchived === "boolean") patch.isArchived = body.isArchived;
    if (body.convertTo === "note") patch.convertedNoteId = randomUUID();
    if (body.convertTo === "task") patch.convertedTaskId = randomUUID();
    const [updated] = await db.update(schema.emails).set(patch).where(eq(schema.emails.id, body.id)).returning();
    if (!updated) return fail(500, "INTERNAL_ERROR", "email update failed");

    if (body.convertTo === "note") {
      emit("pmos.email.converted_to_note", {
        emailId: updated.id,
        subject: updated.subject ?? "",
        body: updated.body ?? "",
        noteId: updated.convertedNoteId,
        correlationId,
      }, correlationId);
    } else if (body.convertTo === "task") {
      emit("pmos.email.converted_to_task", {
        emailId: updated.id,
        subject: updated.subject ?? "",
        body: updated.body ?? "",
        taskId: updated.convertedTaskId,
        correlationId,
      }, correlationId);
    }
    return reply.send({ ok: true });
  });
};

