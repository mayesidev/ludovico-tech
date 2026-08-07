import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve("migrations"));

  return defineConfig({
    test: {
      coverage: {
        exclude: [
          "src/client/main.tsx",
          "src/worker-configuration.d.ts",
          "src/**/*.test.{ts,tsx}",
        ],
        include: ["src/**/*.{ts,tsx}", "scripts/import-sheet-lib.ts"],
        provider: "istanbul",
        reporter: ["text", "json-summary", "html"],
        thresholds: {
          branches: 70,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      projects: [
        {
          test: {
            environment: "node",
            include: ["scripts/**/*.test.ts"],
            name: "node",
          },
        },
        {
          test: {
            environment: "jsdom",
            include: ["src/client/**/*.test.{ts,tsx}"],
            name: "client",
            setupFiles: ["./test/client-setup.ts"],
          },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: {
                configPath: "./wrangler.jsonc",
                environment: "development",
              },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            include: ["src/worker/**/*.test.ts"],
            name: "worker",
            setupFiles: ["./test/apply-migrations.ts"],
          },
        },
      ],
    },
  });
});
