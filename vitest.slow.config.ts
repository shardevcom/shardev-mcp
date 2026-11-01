import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.slow.test.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
    fileParallelism: false,
  },
});
