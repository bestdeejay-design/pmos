import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("notes semantics (integration, needs Postgres)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = "/api/notes/v1";

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app?.close();
  });

  const url = (p: string) => `${base}${p}`;

  it("creates a note, filters by tag, and soft-deletes", async () => {
    const created = await app.inject({
      method: "POST",
      url: url("/notes"),
      payload: { title: "Integ note", bodyMd: "body", tags: ["integ"], profileIds: [] },
    });
    expect(created.statusCode).toBe(201);
    const note = created.json();
    expect(note.id).toBeDefined();

    const filtered = await app.inject({ method: "GET", url: url("/notes?tag=integ") });
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json();
    expect(body.data.some((n: any) => n.id === note.id)).toBe(true);

    // soft delete → isArchived true, still retrievable, hidden from default list
    const del = await app.inject({ method: "DELETE", url: url(`/notes/${note.id}`) });
    expect(del.statusCode).toBe(204);
    const got = await app.inject({ method: "GET", url: url(`/notes/${note.id}`) });
    expect(got.json().isArchived).toBe(true);

    const defaultList = await app.inject({ method: "GET", url: url("/notes?tag=integ") });
    expect(defaultList.json().data.some((n: any) => n.id === note.id)).toBe(false);
  });

  it("templates CRUD round-trip", async () => {
    const c = await app.inject({
      method: "POST",
      url: url("/templates"),
      payload: { name: "Daily", bodyMd: "# {{date}}", profileId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(c.statusCode).toBe(201);
    const tpl = c.json();

    const listed = await app.inject({ method: "GET", url: url("/templates") });
    expect(listed.json().data.some((t: any) => t.id === tpl.id)).toBe(true);

    const upd = await app.inject({ method: "PATCH", url: url(`/templates/${tpl.id}`), payload: { name: "Daily v2" } });
    expect(upd.json().name).toBe("Daily v2");

    const del = await app.inject({ method: "DELETE", url: url(`/templates/${tpl.id}`) });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: url(`/templates/${tpl.id}`) });
    expect(gone.statusCode).toBe(404);
  });
});
