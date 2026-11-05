import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(root, ".env.test") });

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "server-only": path.resolve(root, "./src/server/test/server-only-stub.ts"),
    },
  },
});
