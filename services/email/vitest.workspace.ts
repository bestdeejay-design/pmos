import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      globals: true,
      environment: "node",
      include: ["test/**/*.test.ts"],
      exclude: ["test/integration.*.test.ts"],
      hookTimeout: 30_000,
      testTimeout: 15_000,
    },
  },
  {
    test: {
      name: "integration",
      globals: true,
      environment: "node",
      include: ["test/integration.*.test.ts"],
      hookTimeout: 30_000,
      testTimeout: 15_000,
    },
  },
]);
