import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("export-import OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/export-import.yaml", async () => {
    const openapi = loadOpenapi("export-import");
    const app = await buildApp();
    try {
      await assertRoutesMatch("export-import", app, openapi);
    } finally {
      await app.close();
    }
  });
});
