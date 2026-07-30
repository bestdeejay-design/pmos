import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("notes OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/notes.yaml", async () => {
    const openapi = loadOpenapi("notes");
    const app = await buildApp();
    try {
      await assertRoutesMatch("notes", app, openapi);
    } finally {
      await app.close();
    }
  });
});
