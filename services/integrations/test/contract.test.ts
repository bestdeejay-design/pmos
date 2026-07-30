import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("integrations OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/integrations.yaml", async () => {
    const openapi = loadOpenapi("integrations");
    const app = await buildApp();
    try {
      await assertRoutesMatch("integrations", app, openapi);
    } finally {
      await app.close();
    }
  });
});
