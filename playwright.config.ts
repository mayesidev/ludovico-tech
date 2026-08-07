import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const stateDirectory =
  process.env.E2E_STATE_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "ludovico-tech-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `CI=1 corepack pnpm exec wrangler d1 migrations apply ludovico-tech-development --local --env development --persist-to ${stateDirectory} && CI=1 corepack pnpm exec wrangler dev src/worker/index.ts --local --env development --persist-to ${stateDirectory} --port 8788 --show-interactive-dev-session=false`,
      url: "http://127.0.0.1:8788/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "VITE_API_PORT=8788 corepack pnpm exec vite --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
