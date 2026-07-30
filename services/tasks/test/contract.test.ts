import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("tasks OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/tasks.yaml", async () => {
    const openapi = loadOpenapi("tasks");
    const app = await buildApp();
    try {
      await assertRoutesMatch("tasks", app, openapi);
    } finally {
      await app.close();
    }
  });
});
