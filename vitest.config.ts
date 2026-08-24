import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scaffold/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    setupFiles: ["scaffold/tests/setup.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
