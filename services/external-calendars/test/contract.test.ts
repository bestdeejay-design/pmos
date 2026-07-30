import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("external-calendars OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/external-calendars.yaml", async () => {
    const openapi = loadOpenapi("external-calendars");
    const app = await buildApp();
    try {
      await assertRoutesMatch("external-calendars", app, openapi);
    } finally {
      await app.close();
    }
  });
});
