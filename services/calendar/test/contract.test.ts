import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("calendar OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/calendar.yaml", async () => {
    const openapi = loadOpenapi("calendar");
    const app = await buildApp();
    try {
      await assertRoutesMatch("calendar", app, openapi);
    } finally {
      await app.close();
    }
  });
});
