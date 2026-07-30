import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("files OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/files.yaml", async () => {
    const openapi = loadOpenapi("files");
    const app = await buildApp();
    try {
      await assertRoutesMatch("files", app, openapi);
    } finally {
      await app.close();
    }
  });
});
