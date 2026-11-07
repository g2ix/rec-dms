import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.STAGING_BASE_URL || "http://127.0.0.1:9";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /staging\.spec\.ts/,
  retries: 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
