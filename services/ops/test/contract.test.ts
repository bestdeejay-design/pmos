import { buildApp } from "../src/app.js";
import { assertRoutesMatch, loadOpenapi } from "../../../contracts/test/helper.ts";
import { describe, it } from "vitest";
import { vi } from "vitest";

vi.mock("@pmos/event-bus", () => ({
  EventBus: {
    init: vi.fn(),
    get: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      ensureStream: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn(() => true),
      listDlq: vi.fn().mockResolvedValue([]),
      replayDlq: vi.fn().mockResolvedValue("pmos.x.y"),
    })),
  },
}));

describe("ops OpenAPI contract conformance", () => {
  it("registers every route declared in contracts/openapi/ops.yaml", async () => {
    const openapi = loadOpenapi("ops");
    const app = await buildApp();
    try {
      await assertRoutesMatch("ops", app, openapi);
    } finally {
      await app.close();
    }
  });
});