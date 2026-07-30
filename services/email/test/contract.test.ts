import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("email OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/email.yaml", async () => {
    const openapi = loadOpenapi("email");
    const app = await buildApp();
    try {
      await assertRoutesMatch("email", app, openapi);
    } finally {
      await app.close();
    }
  });
});
