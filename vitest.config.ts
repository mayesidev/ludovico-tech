import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve("migrations"));

  return {
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
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
