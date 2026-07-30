import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("search-rag OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/search-rag.yaml", async () => {
    const openapi = loadOpenapi("search-rag");
    const app = await buildApp();
    try {
      await assertRoutesMatch("search-rag", app, openapi);
    } finally {
      await app.close();
    }
  });
});
