import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/connection.js";
import { profiles } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const BASE = "/api/profiles/v1";

describe.skipIf(!HAS_DB)("profiles (real Postgres): default + delete rules", () => {
  let app: any;
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await db.delete(profiles); // isolate test data
  });

  afterAll(async () => {
    await db.delete(profiles); // best-effort cleanup
    if (app) await app.close();
  });

  it("first created profile automatically becomes is_default=true", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/profiles`,
      payload: { name: "Work", color: "#4A90D9" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as any;
    created.push(body.id);
    expect(body.isDefault).toBe(true);
  });

  it("second profile is NOT default", async () => {
    const r = await app.inject({
      method: "POST",
      url: `${BASE}/profiles`,
      payload: { name: "Home", color: "#50C878" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as any;
    created.push(body.id);
    expect(body.isDefault).toBe(false);
  });

  it("rejects invalid color with 422", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `${BASE}/profiles`,
      payload: { name: "Bad", color: "red" },
    });
    expect(bad.statusCode).toBe(422);
    const badBody = bad.json() as any;
    expect(String(badBody.message)).toContain("color");

    const patch = await app.inject({
      method: "PATCH",
      url: `${BASE}/profiles/${created[0]}`,
      payload: { color: "#12" },
    });
    expect(patch.statusCode).toBe(422);
  });

  it("accepts a valid hex color", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `${BASE}/profiles/${created[1]}`,
      payload: { color: "#ABCDEF" },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as any).color).toBe("#ABCDEF");
  });

  it("cannot delete the default profile → 409", async () => {
    const r = await app.inject({ method: "DELETE", url: `${BASE}/profiles/${created[0]}` });
    expect(r.statusCode).toBe(409);
    expect((r.json() as any).code).toBe("CONFLICT");
  });

  it("cannot delete the last remaining profile → 409", async () => {
    // Delete the non-default profile: allowed while another one remains.
    const del = await app.inject({ method: "DELETE", url: `${BASE}/profiles/${created[1]}` });
    expect(del.statusCode).toBe(204);
    // Only the default profile remains — now make it non-default and try to delete it.
    const unset = await app.inject({
      method: "PATCH",
      url: `${BASE}/profiles/${created[0]}`,
      payload: { isDefault: false },
    });
    expect(unset.statusCode).toBe(200);
    const last = await app.inject({ method: "DELETE", url: `${BASE}/profiles/${created[0]}` });
    expect(last.statusCode).toBe(409);
    expect((last.json() as any).code).toBe("CONFLICT");
  });
});
