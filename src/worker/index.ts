import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getRuntimeConfig,
  isProductionReady,
  RuntimeConfigurationError,
  type AppEnv,
} from "./env";
import { registerAuthRoutes } from "./routes/auth";
import { registerMovieRoutes } from "./routes/movies";
import { registerRotationRoutes } from "./routes/rotation";
import { registerTmdbRoutes } from "./routes/tmdb";

export const createApp = () => {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  app.use("/api/*", cors({ origin: "*" }));
  api.get("/health", (c) => {
    const config = getRuntimeConfig(c.env);
    const ready = isProductionReady(c.env);
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
  app.route("/api", api);

  app.get("*", async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text("Movie List API is running. Start Vite for the UI.", 404);
  });

  app.onError((error, c) => {
    if (error instanceof RuntimeConfigurationError) {
      return c.json({ error: "Application is not configured" }, 503);
    }
    throw error;
  });

  return app;
};

const app = createApp();

export default app;
