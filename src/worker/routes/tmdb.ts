import { type Context, type Hono } from "hono";
import { getActor, type AppEnv } from "../env";
import { getTmdbMovie, searchTmdbMovies, TmdbServiceError } from "../tmdb";

export const tmdbErrorResponse = (error: unknown, c: Context<AppEnv>) => {
  if (!(error instanceof TmdbServiceError)) throw error;
  if (error.retryAfter) c.header("Retry-After", error.retryAfter);
  return c.json(
    {
      error:
        error.status === 503
          ? "TMDB is not configured"
          : error.status === 429
            ? "TMDB is temporarily rate limited"
            : "TMDB lookup failed",
    },
    error.status,
  );
};

export const registerTmdbRoutes = (app: Hono<AppEnv>) => {
  app.get("/tmdb/search", async (c) => {
    const actor = await getActor(c.env, c.req.raw);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const query = c.req.query("query")?.trim();
    if (!query) return c.json({ results: [] });
    if (query.length > 100) return c.json({ error: "Query is too long" }, 400);

    try {
      return c.json({ results: await searchTmdbMovies(c.env, query) });
    } catch (error) {
      return tmdbErrorResponse(error, c);
    }
  });

  app.get("/tmdb/movies/:id", async (c) => {
    const actor = await getActor(c.env, c.req.raw);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const movieId = Number(c.req.param("id"));
    if (!Number.isInteger(movieId) || movieId <= 0) {
      return c.json({ error: "Invalid TMDB movie ID" }, 400);
    }

    try {
      return c.json({ movie: (await getTmdbMovie(c.env, movieId)).data });
    } catch (error) {
      return tmdbErrorResponse(error, c);
    }
  });
};
