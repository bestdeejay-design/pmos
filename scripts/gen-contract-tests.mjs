/**
 * Generate OpenAPI-conformance contract tests for all 16 services.
 *
 * Writes `services/<svc>/test/contract.test.ts` which loads the service's
 * OpenAPI doc and asserts every declared route is registered by buildApp().
 * See contracts/test/helper.ts and ADR-002 (Pact replaced by OpenAPI conformance
 * at the scaffold stage).
 *
 * Reproducible: run `node scripts/gen-contract-tests.mjs` from repo root.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SERVICES = [
  "profiles", "settings", "notes", "tasks", "calendar", "projects",
  "files", "search-rag", "ai-gateway", "agent", "export-import",
  "integrations", "email", "external-calendars", "time-tracking", "sync",
];

function testFile(svc) {
  return `import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it, expect } from "vitest";

describe("${svc} OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/${svc}.yaml", async () => {
    const openapi = loadOpenapi("${svc}");
    const app = await buildApp();
    try {
      await assertRoutesMatch("${svc}", app, openapi);
    } finally {
      await app.close();
    }
  });
});
`;
}

let count = 0;
for (const svc of SERVICES) {
  const target = join(ROOT, "services", svc, "test", "contract.test.ts");
  if (!existsSync(join(ROOT, "services", svc))) {
    console.warn(`skip ${svc}: service dir not found`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, testFile(svc));
  count++;
}
console.log(`generated ${count} contract tests`);
