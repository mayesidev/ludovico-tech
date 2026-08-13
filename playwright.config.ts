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
  webServer: {
    command: `corepack pnpm exec wrangler d1 migrations apply ludovico-tech-development --config wrangler.jsonc --local --env development --persist-to ${stateDirectory} && corepack pnpm exec vite --host 127.0.0.1 --port 5174`,
    env: {
      CI: "1",
      CLOUDFLARE_ENV: "development",
      E2E_NETWORK_DISABLED: "1",
      E2E_STATE_DIR: stateDirectory,
    },
    url: "http://127.0.0.1:5174/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
