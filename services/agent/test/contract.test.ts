import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("agent OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/agent.yaml", async () => {
    const openapi = loadOpenapi("agent");
    const app = await buildApp();
    try {
      await assertRoutesMatch("agent", app, openapi);
    } finally {
      await app.close();
    }
  });
});
