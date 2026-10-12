import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db", AUTH_SECRET: "test-only-secret" },
    // One SQLite file shared by all tests: run files sequentially.
    fileParallelism: false,
  },
});
