import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("sync OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/sync.yaml", async () => {
    const openapi = loadOpenapi("sync");
    const app = await buildApp();
    try {
      await assertRoutesMatch("sync", app, openapi);
    } finally {
      await app.close();
    }
  });
});
