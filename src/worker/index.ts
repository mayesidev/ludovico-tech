import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getRuntimeConfig,
  isDeploymentReady,
  isMaintenanceMode,
  RuntimeConfigurationError,
  type AppEnv,
} from "./env";
import { registerAuthRoutes } from "./routes/auth";
import { registerMovieRoutes } from "./routes/movies";
import { registerRotationRoutes } from "./routes/rotation";
import { registerTmdbRoutes } from "./routes/tmdb";
import { registerTmdbRefreshRoutes } from "./routes/tmdb-refresh";
import { runTmdbRefresh } from "./tmdb-refresh";

export const createApp = () => {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!isMaintenanceMode(c.env)) return next();
    const config = getRuntimeConfig(c.env);
    const metadata = {
      commit: c.env.GIT_SHA ?? "unknown",
      environment: config.environment,
      maintenance: true,
      ok: false,
      version: c.env.APP_VERSION ?? "unversioned",
    } as const;
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", "300");
    if (c.req.path === "/api/health") return c.json(metadata, 503);
    if (c.req.path.startsWith("/api/")) {
      return c.json(
        {
          error: "Application is temporarily unavailable for maintenance",
          maintenance: true as const,
        },
        503,
      );
    }
    return c.html(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ludovico Tech maintenance</title><body><main><h1>Ludovico Tech is temporarily unavailable</h1><p>We’re completing a scheduled upgrade. Please try again shortly.</p></main></body></html>',
      503,
    );
  });

  app.use("/api/*", cors({ origin: "*" }));
  api.get("/health", (c) => {
    const config = getRuntimeConfig(c.env);
    const ready = isDeploymentReady(c.env);
    return c.json(
      {
        ok: ready,
        environment: config.environment,
        version: c.env.APP_VERSION ?? "unversioned",
        commit: c.env.GIT_SHA ?? "unknown",
      },
      ready ? 200 : 503,
    );
  });

  registerAuthRoutes(api);
  registerMovieRoutes(api);
  registerRotationRoutes(api);
  registerTmdbRoutes(api);
  registerTmdbRefreshRoutes(api);
  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.get("*", async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text("Ludovico Tech API is running. Start Vite for the UI.", 404);
  });

  app.onError((error, c) => {
    if (error instanceof RuntimeConfigurationError) {
      return c.json({ error: "Application is not configured" }, 503);
    }
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
};

const app = createApp();

const worker: ExportedHandler<AppEnv["Bindings"]> = {
  fetch: app.fetch,
  scheduled: async (controller, env) => {
    if (isMaintenanceMode(env)) return;
    const result = await runTmdbRefresh(env, {
      timestamp: new Date(controller.scheduledTime).toISOString(),
    });
    if (result.started) console.info("TMDB refresh completed", result);
  },
};

export default worker;
