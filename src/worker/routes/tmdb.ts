import { type Hono } from "hono";
import type { AppEnv } from "../env";

export const registerTmdbRoutes = (app: Hono<AppEnv>) => {
  app.get("/tmdb/search", async (c) => {
    const query = c.req.query("query")?.trim();
    if (!query) return c.json({ results: [] });
    if (!c.env.TMDB_READ_ACCESS_TOKEN) {
      return c.json({ error: "TMDB is not configured" }, 503);
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US`,
      {
        headers: {
          Authorization: `Bearer ${c.env.TMDB_READ_ACCESS_TOKEN}`,
          accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      return c.json(
        { error: "TMDB lookup failed" },
        response.status as 400 | 401 | 403 | 404 | 429 | 500,
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        id: number;
        title: string;
        release_date?: string;
        poster_path?: string | null;
        imdb_id?: string;
      }>;
    };
    return c.json({
      results: (data.results ?? [])
        .slice(0, 8)
        .map(({ id, title, release_date, poster_path, imdb_id }) => ({
          id,
          title,
          releaseDate: release_date ?? null,
          posterPath: poster_path ?? null,
          imdbId: imdb_id ?? null,
        })),
    });
  });
};
