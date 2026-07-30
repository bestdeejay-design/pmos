import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("settings OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/settings.yaml", async () => {
    const openapi = loadOpenapi("settings");
    const app = await buildApp();
    try {
      await assertRoutesMatch("settings", app, openapi);
    } finally {
      await app.close();
    }
  });
});
