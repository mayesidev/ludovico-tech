import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => {
  process.env.CLOUDFLARE_ENV ??= "development";
  const e2eStateDirectory = process.env.E2E_STATE_DIR;

  return {
    plugins: [
      react(),
      babel({
        include: /[/\\]src[/\\]client[/\\].*\.[tj]sx?$/,
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      cloudflare({
        config: e2eStateDirectory
          ? (workerConfig) => {
              workerConfig.secrets = {
                required: ["E2E_NETWORK_DISABLED"],
              };
            }
          : undefined,
        inspectorPort: process.env.CI ? false : undefined,
        persistState: e2eStateDirectory ? { path: e2eStateDirectory } : true,
        remoteBindings: false,
      }),
    ],
    server: {
      port: 5173,
    },
  };
});
