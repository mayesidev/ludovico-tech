import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import type { AppEnv } from "../env";
import {
  getMovie,
  getNowShowing,
  getRemainingFranchiseMovies,
  movieSelect,
  type MovieRow,
} from "../db";
import { audit, mutationActor } from "../middleware";
import { movieEditInput, movieInput, ratingInput } from "../schemas";
import { newId, normalizeTitle, now } from "../env";

export const registerMovieRoutes = (app: Hono<AppEnv>) => {
  app.get("/movies", async (c) => {
    const status = c.req.query("status") ?? "all";
    const query =
      status === "unwatched"
        ? `${movieSelect} WHERE ratings.id IS NULL`
        : status === "watched"
          ? `${movieSelect} WHERE ratings.id IS NOT NULL`
          : movieSelect;
    const result = await c.env.DB.prepare(
      `${query} ORDER BY movies.title COLLATE NOCASE`,
    ).all<MovieRow>();
    return c.json({ movies: result.results });
  });

  app.get("/franchises", async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT franchises.*, COUNT(movies.id) AS movie_count,
      SUM(CASE WHEN ratings.id IS NOT NULL THEN 1 ELSE 0 END) AS watched_count
     FROM franchises
     LEFT JOIN franchise_movies ON franchise_movies.franchise_id = franchises.id
     LEFT JOIN movies ON movies.id = franchise_movies.movie_id
     LEFT JOIN ratings ON ratings.movie_id = movies.id
     GROUP BY franchises.id ORDER BY franchises.name COLLATE NOCASE`,
    ).all();
    return c.json({ franchises: result.results });
  });

  app.get("/franchises/:id", async (c) => {
    const franchise = await c.env.DB.prepare(
      "SELECT id, name, order_confirmed, created_at, updated_at FROM franchises WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();
    if (!franchise) return c.json({ error: "Franchise not found" }, 404);

    const movies = await c.env.DB.prepare(
      `${movieSelect} WHERE franchise_movies.franchise_id = ? ORDER BY franchise_movies.position ASC`,
    )
      .bind(c.req.param("id"))
      .all<MovieRow>();
    return c.json({ franchise, movies: movies.results });
  });

  app.get("/now-showing", async (c) => {
    const current = await getNowShowing(c.env);
    if (!current) return c.json({ nowShowing: null });
    const remaining = current.franchise_id
      ? await getRemainingFranchiseMovies(c.env, current.franchise_id)
      : [];
    return c.json({ nowShowing: current, remainingFranchiseMovies: remaining });
  });

  app.post("/movies", zValidator("json", movieInput), async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const input = c.req.valid("json");
    const id = newId();
    const timestamp = now();
    let franchiseId: string | null = null;

    if (input.franchiseName) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM franchises WHERE name_normalized = ?",
      )
        .bind(normalizeTitle(input.franchiseName))
        .first<{ id: string }>();
      franchiseId = existing?.id ?? newId();
      if (!existing) {
        await c.env.DB.prepare(
          "INSERT INTO franchises (id, name, name_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(
            franchiseId,
            input.franchiseName,
            normalizeTitle(input.franchiseName),
            timestamp,
            timestamp,
          )
          .run();
      }
    }

    const position = franchiseId
      ? ((
          await c.env.DB.prepare(
            "SELECT COALESCE(MAX(position), 0) AS max_position FROM franchise_movies WHERE franchise_id = ?",
          )
            .bind(franchiseId)
            .first<{ max_position: number }>()
        )?.max_position ?? 0) + 1
      : null;

    await c.env.DB.prepare(
      `INSERT INTO movies (id, title, title_normalized, added_at, added_by, updated_at, updated_by,
      release_date, poster_path, tmdb_id, tmdb_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.title,
        normalizeTitle(input.title),
        timestamp,
        actor.id,
        timestamp,
        actor.id,
        input.releaseDate ?? null,
        input.posterPath ?? null,
        input.tmdbId ?? null,
        input.tmdbId ? timestamp : null,
      )
      .run();

    if (franchiseId && position !== null) {
      await c.env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      )
        .bind(franchiseId, id, position)
        .run();
    }
    await audit(c.env, "movie", id, "created", actor.id, {
      title: input.title,
    });
    return c.json({ movie: await getMovie(c.env, id) }, 201);
  });

  app.patch("/movies/:id", zValidator("json", movieEditInput), async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const input = c.req.valid("json");
    const existing = await getMovie(c.env, movieId);
    if (!existing) return c.json({ error: "Movie not found" }, 404);

    const timestamp = now();
    const title = input.title ?? existing.title;
    await c.env.DB.prepare(
      `UPDATE movies SET title = ?, title_normalized = ?, updated_at = ?, updated_by = ?,
      release_date = ?, poster_path = ?, tmdb_id = ?, tmdb_fetched_at = ? WHERE id = ?`,
    )
      .bind(
        title,
        normalizeTitle(title),
        timestamp,
        actor.id,
        input.releaseDate === undefined
          ? existing.release_date
          : input.releaseDate,
        input.posterPath === undefined
          ? existing.poster_path
          : input.posterPath,
        input.tmdbId === undefined ? existing.tmdb_id : input.tmdbId,
        input.tmdbId !== undefined ||
          input.releaseDate !== undefined ||
          input.posterPath !== undefined
          ? timestamp
          : existing.tmdb_fetched_at,
        movieId,
      )
      .run();
    await audit(c.env, "movie", movieId, "updated", actor.id, {
      fields: Object.keys(input),
    });
    return c.json({ movie: await getMovie(c.env, movieId) });
  });

  app.post("/movies/:id/rate", zValidator("json", ratingInput), async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const input = c.req.valid("json");
    const movie = await getMovie(c.env, movieId);
    if (!movie) return c.json({ error: "Movie not found" }, 404);

    const timestamp = now();
    await c.env.DB.prepare(
      `INSERT INTO ratings (id, movie_id, recorded_at, watched_at, score, phrase, source, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, 'application', ?)
       ON CONFLICT(movie_id) DO UPDATE SET recorded_at = excluded.recorded_at,
       watched_at = COALESCE(ratings.watched_at, excluded.watched_at), score = excluded.score,
       phrase = excluded.phrase, source = excluded.source, recorded_by = excluded.recorded_by`,
    )
      .bind(
        newId(),
        movieId,
        timestamp,
        timestamp,
        input.score,
        input.phrase,
        actor.id,
      )
      .run();
    await c.env.DB.prepare(
      "UPDATE now_showing SET status = 'watched', updated_at = ? WHERE id = 1 AND movie_id = ?",
    )
      .bind(timestamp, movieId)
      .run();
    await audit(c.env, "movie", movieId, "rated", actor.id, {
      score: input.score,
    });
    return c.json({
      movie: await getMovie(c.env, movieId),
      nowShowing: await getNowShowing(c.env),
    });
  });
};
