import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("time-tracking OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/time-tracking.yaml", async () => {
    const openapi = loadOpenapi("time-tracking");
    const app = await buildApp();
    try {
      await assertRoutesMatch("time-tracking", app, openapi);
    } finally {
      await app.close();
    }
  });
});
