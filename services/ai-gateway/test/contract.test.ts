import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("ai-gateway OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/ai-gateway.yaml", async () => {
    const openapi = loadOpenapi("ai-gateway");
    const app = await buildApp();
    try {
      await assertRoutesMatch("ai-gateway", app, openapi);
    } finally {
      await app.close();
    }
  });
});
