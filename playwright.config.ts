import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT, serverEnv, loadTestEnv } from "./e2e/test-env";

// The test environment only (.env.test, a *_test database); this throws before any server starts otherwise.
loadTestEnv();

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /staging\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // One `next dev` server compiles each route on first use; parallel sign-ins time out while it does.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  // Its own server on its own port and build folder, never a dev server already running on .env.local.
  webServer: {
    command: `pnpm exec next dev --turbopack --port ${E2E_PORT}`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 180_000,
    env: serverEnv(),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
