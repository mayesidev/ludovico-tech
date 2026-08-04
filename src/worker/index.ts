import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { registerAuthRoutes } from "./routes/auth";
import { registerMovieRoutes } from "./routes/movies";
import { registerRotationRoutes } from "./routes/rotation";
import { registerTmdbRoutes } from "./routes/tmdb";

export const createApp = () => {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  app.use("/api/*", cors({ origin: "*" }));
  api.get("/health", (c) =>
    c.json({ ok: true, environment: c.env.APP_ENV ?? "development" }),
  );

  registerAuthRoutes(api);
  registerMovieRoutes(api);
  registerRotationRoutes(api);
  registerTmdbRoutes(api);
  app.route("/api", api);

  app.get("*", async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text("Movie List API is running. Start Vite for the UI.", 404);
  });

  return app;
};

const app = createApp();

export default app;
