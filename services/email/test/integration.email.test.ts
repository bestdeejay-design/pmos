import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { imapAccounts, emails } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/email/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe.skipIf(!HAS_DB)("email (real Postgres): imap accounts + emails", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(emails);
    await db.delete(imapAccounts);
  });

  afterAll(async () => {
    await db.delete(emails).catch(() => {});
    await db.delete(imapAccounts).catch(() => {});
    if (app) await app.close();
  });

  it("creates an imap account and never exposes the password", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/imap`,
      payload: { host: "imap.example.com", port: 993, ssl: true, username: "me@example.com", password: "hunter2", syncEnabled: true },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    expect(row.id).toMatch(UUID_RE);
    expect(row.host).toBe("imap.example.com");
    expect(row.username).toBe("me@example.com");
    expect(row.encryptedPassword).toBeUndefined();
    expect(row.password).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  it("lists imap accounts without passwords", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}/imap` });
    expect(res.statusCode).toBe(200);
    const { data, pagination } = res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(pagination.total).toBeGreaterThan(0);
    for (const row of data) {
      expect(row.encryptedPassword).toBeUndefined();
      expect(row.password).toBeUndefined();
    }
  });

  it("sync against an unreachable host returns 502 IMAP_UNAVAILABLE", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${BASE}/imap`,
      payload: { host: "127.0.0.1", port: 9, ssl: false, username: "u", password: "p", syncEnabled: true },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const res = await app.inject({ method: "POST", url: `${BASE}/imap/${id}/sync` });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.code).toBe("IMAP_UNAVAILABLE");
  });

  it("GET /imap/emails filters by accountId and PATCH converts to a note", async () => {
    const acc = await app.inject({
      method: "POST",
      url: `${BASE}/imap`,
      payload: { host: "imap.example.com", port: 993, ssl: true, username: "conv@example.com", password: "pw" },
    });
    expect(acc.statusCode).toBe(201);
    const accountId = (acc.json() as { id: string }).id;

    const [email] = await db.insert(emails).values({
      accountId,
      messageId: `<m-${randomUUID()}@example.com>`,
      from: "sender@example.com",
      subject: "Hello",
      body: "body text",
      receivedAt: new Date().toISOString(),
    }).returning();
    expect(email).toBeTruthy();
    const emailId = email!.id;

    const list = await app.inject({ method: "GET", url: `${BASE}/imap/emails?accountId=${accountId}` });
    expect(list.statusCode).toBe(200);
    const { data, pagination } = list.json();
    expect(pagination.total).toBe(1);
    expect(data[0]!.id).toBe(emailId);

    const archived = await app.inject({
      method: "PATCH",
      url: `${BASE}/imap/emails`,
      payload: { id: emailId, isArchived: true },
    });
    expect(archived.statusCode).toBe(200);

    const converted = await app.inject({
      method: "PATCH",
      url: `${BASE}/imap/emails`,
      payload: { id: emailId, convertTo: "note" },
    });
    expect(converted.statusCode).toBe(200);
    expect((converted.json() as { ok: boolean }).ok).toBe(true);

    const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.isArchived).toBe(true);
    expect(row?.convertedNoteId).toMatch(UUID_RE);
    expect(row?.convertedTaskId).toBeNull();

    const filtered = await app.inject({ method: "GET", url: `${BASE}/imap/emails?accountId=${accountId}&isArchived=true` });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().pagination.total).toBe(1);
  });

  it("PATCH convertTo task sets convertedTaskId", async () => {
    const acc = await app.inject({
      method: "POST",
      url: `${BASE}/imap`,
      payload: { host: "imap.example.com", port: 993, ssl: true, username: "task@example.com", password: "pw" },
    });
    const accountId = (acc.json() as { id: string }).id;
    const [email] = await db.insert(emails).values({
      accountId,
      messageId: `<m-${randomUUID()}@example.com>`,
      from: "sender@example.com",
      subject: "Taskify",
    }).returning();

    const res = await app.inject({
      method: "PATCH",
      url: `${BASE}/imap/emails`,
      payload: { id: email!.id, convertTo: "task" },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db.select().from(emails).where(eq(emails.id, email!.id)).limit(1);
    expect(row?.convertedTaskId).toMatch(UUID_RE);
  });

  it("PATCH /imap/emails with unknown id returns 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${BASE}/imap/emails`,
      payload: { id: randomUUID(), isArchived: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
