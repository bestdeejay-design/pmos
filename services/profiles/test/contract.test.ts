import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("profiles OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/profiles.yaml", async () => {
    const openapi = loadOpenapi("profiles");
    const app = await buildApp();
    try {
      await assertRoutesMatch("profiles", app, openapi);
    } finally {
      await app.close();
    }
  });
});
