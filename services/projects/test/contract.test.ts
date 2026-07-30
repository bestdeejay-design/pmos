import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("projects OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/projects.yaml", async () => {
    const openapi = loadOpenapi("projects");
    const app = await buildApp();
    try {
      await assertRoutesMatch("projects", app, openapi);
    } finally {
      await app.close();
    }
  });
});
