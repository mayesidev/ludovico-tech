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
import { auditStatement, mutationActor } from "../middleware";
import { movieEditInput, movieInput, ratingInput } from "../schemas";
import { newId, normalizeTitle, now } from "../env";
import { getTmdbMovie } from "../tmdb";
import { tmdbErrorResponse } from "./tmdb";

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
    let metadata = null;
    if (input.tmdbId) {
      try {
        metadata = await getTmdbMovie(c.env, input.tmdbId);
      } catch (error) {
        return tmdbErrorResponse(error, c);
      }
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM movies WHERE tmdb_id = ?",
      )
        .bind(input.tmdbId)
        .first();
      if (duplicate) {
        return c.json(
          { error: "That TMDB movie is already in the catalog" },
          409,
        );
      }
    }
    const title = metadata?.title ?? input.title;
    let franchiseId: string | null = null;
    const statements: D1PreparedStatement[] = [];

    if (input.franchiseName) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM franchises WHERE name_normalized = ?",
      )
        .bind(normalizeTitle(input.franchiseName))
        .first<{ id: string }>();
      franchiseId = existing?.id ?? newId();
      if (!existing) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO franchises (id, name, name_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(
            franchiseId,
            input.franchiseName,
            normalizeTitle(input.franchiseName),
            timestamp,
            timestamp,
          ),
        );
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

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO movies (id, title, title_normalized, added_at, added_by, updated_at, updated_by,
        release_date, poster_path, runtime_minutes, tmdb_id, tmdb_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        title,
        normalizeTitle(title),
        timestamp,
        actor.id,
        timestamp,
        actor.id,
        metadata?.releaseDate ?? null,
        metadata?.posterPath ?? null,
        metadata?.runtimeMinutes ?? null,
        input.tmdbId ?? null,
        input.tmdbId ? timestamp : null,
      ),
    );

    if (franchiseId && position !== null) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
        ).bind(franchiseId, id, position),
      );
    }
    statements.push(
      auditStatement(c.env, "movie", id, "created", actor.id, {
        title,
      }),
    );
    await c.env.DB.batch(statements);
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
    const titleChanged =
      input.title !== undefined && input.title !== existing.title;
    if (
      titleChanged &&
      existing.tmdb_id !== null &&
      input.tmdbId === undefined
    ) {
      return c.json(
        { error: "Confirm or remove the TMDB match after changing the title" },
        400,
      );
    }

    let metadata = null;
    if (input.tmdbId) {
      try {
        metadata = await getTmdbMovie(c.env, input.tmdbId);
      } catch (error) {
        return tmdbErrorResponse(error, c);
      }
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM movies WHERE tmdb_id = ? AND id <> ?",
      )
        .bind(input.tmdbId, movieId)
        .first();
      if (duplicate) {
        return c.json(
          { error: "That TMDB movie is already in the catalog" },
          409,
        );
      }
    }
    const title = metadata?.title ?? input.title ?? existing.title;
    const tmdbChangeRequested = input.tmdbId !== undefined;
    const releaseDate =
      metadata?.releaseDate ??
      (tmdbChangeRequested ? null : existing.release_date);
    const posterPath =
      metadata?.posterPath ??
      (tmdbChangeRequested ? null : existing.poster_path);
    const runtimeMinutes =
      metadata?.runtimeMinutes ??
      (tmdbChangeRequested ? null : existing.runtime_minutes);

    let targetFranchiseId = existing.franchise_id;
    let targetFranchiseName: string | null = null;
    let createFranchise = false;
    const franchiseChangeRequested = input.franchiseName !== undefined;
    if (franchiseChangeRequested) {
      targetFranchiseName = input.franchiseName || null;
      if (!targetFranchiseName) {
        targetFranchiseId = null;
      } else if (
        existing.franchise_id &&
        normalizeTitle(targetFranchiseName) ===
          normalizeTitle(existing.franchise_name ?? "")
      ) {
        targetFranchiseId = existing.franchise_id;
      } else {
        const target = await c.env.DB.prepare(
          "SELECT id FROM franchises WHERE name_normalized = ?",
        )
          .bind(normalizeTitle(targetFranchiseName))
          .first<{ id: string }>();
        targetFranchiseId = target?.id ?? newId();
        createFranchise = !target;
      }
    }

    const membershipChanged =
      franchiseChangeRequested && targetFranchiseId !== existing.franchise_id;
    const targetPosition =
      membershipChanged && targetFranchiseId
        ? ((
            await c.env.DB.prepare(
              "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM franchise_movies WHERE franchise_id = ?",
            )
              .bind(targetFranchiseId)
              .first<{ position: number }>()
          )?.position ?? 1)
        : null;

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE movies SET title = ?, title_normalized = ?, updated_at = ?, updated_by = ?,
        release_date = ?, poster_path = ?, runtime_minutes = ?, tmdb_id = ?,
        tmdb_fetched_at = CASE WHEN ? THEN ? ELSE tmdb_fetched_at END
        WHERE id = ?`,
      ).bind(
        title,
        normalizeTitle(title),
        timestamp,
        actor.id,
        releaseDate,
        posterPath,
        runtimeMinutes,
        input.tmdbId === undefined ? existing.tmdb_id : input.tmdbId,
        tmdbChangeRequested ? 1 : 0,
        input.tmdbId ? timestamp : null,
        movieId,
      ),
    ];

    if (membershipChanged) {
      if (createFranchise && targetFranchiseId && targetFranchiseName) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO franchises (id, name, name_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(
            targetFranchiseId,
            targetFranchiseName,
            normalizeTitle(targetFranchiseName),
            timestamp,
            timestamp,
          ),
        );
      }
      if (existing.franchise_id) {
        statements.push(
          c.env.DB.prepare(
            "DELETE FROM franchise_movies WHERE franchise_id = ? AND movie_id = ?",
          ).bind(existing.franchise_id, movieId),
        );
      }
      if (targetFranchiseId && targetPosition !== null) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
          ).bind(targetFranchiseId, movieId, targetPosition),
          c.env.DB.prepare(
            "UPDATE franchises SET order_confirmed = 0, updated_at = ? WHERE id = ?",
          ).bind(timestamp, targetFranchiseId),
        );
      }
      statements.push(
        c.env.DB.prepare(
          `UPDATE now_showing SET franchise_id = ?,
           status = CASE
             WHEN status = 'watched' THEN 'watched'
             WHEN ? IS NULL THEN 'ready'
             ELSE 'pending_order'
           END,
           updated_at = ?
           WHERE id = 1 AND movie_id = ?`,
        ).bind(targetFranchiseId, targetFranchiseId, timestamp, movieId),
      );
      if (existing.franchise_id) {
        statements.push(
          c.env.DB.prepare(
            "UPDATE franchises SET updated_at = ? WHERE id = ?",
          ).bind(timestamp, existing.franchise_id),
          c.env.DB.prepare(
            `DELETE FROM franchises WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM franchise_movies WHERE franchise_id = ?
             )`,
          ).bind(existing.franchise_id, existing.franchise_id),
        );
      }
    }

    statements.push(
      auditStatement(c.env, "movie", movieId, "updated", actor.id, {
        fields: Object.keys(input),
      }),
    );
    await c.env.DB.batch(statements);
    return c.json({ movie: await getMovie(c.env, movieId) });
  });

  app.delete("/movies/:id", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const existing = await getMovie(c.env, movieId);
    if (!existing) return c.json({ error: "Movie not found" }, 404);
    if (existing.rating_score !== null) {
      return c.json({ error: "Watched movies cannot be deleted" }, 409);
    }

    const timestamp = now();
    const auditId = newId();
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `INSERT INTO audit_log
         (id, entity_type, entity_id, action, actor_id, created_at, details_json)
         SELECT ?, 'movie', ?, 'deleted', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM movies
           LEFT JOIN ratings ON ratings.movie_id = movies.id
           WHERE movies.id = ? AND ratings.id IS NULL
         )`,
      ).bind(
        auditId,
        movieId,
        actor.id,
        timestamp,
        JSON.stringify({ title: existing.title }),
        movieId,
      ),
      c.env.DB.prepare(
        `UPDATE now_showing
         SET rolled_movie_id = NULL, movie_id = NULL, franchise_id = NULL,
             status = 'empty', rolled_at = NULL, updated_at = ?
         WHERE id = 1 AND (movie_id = ? OR rolled_movie_id = ?)
           AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
      ).bind(timestamp, movieId, movieId, auditId),
      c.env.DB.prepare(
        `DELETE FROM rolls
         WHERE (rolled_movie_id = ? OR actual_movie_id = ?)
           AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
      ).bind(movieId, movieId, auditId),
      c.env.DB.prepare(
        `DELETE FROM movies WHERE id = ?
         AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
      ).bind(movieId, auditId),
    ];
    if (existing.franchise_id) {
      statements.push(
        c.env.DB.prepare(
          `DELETE FROM franchises WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM franchise_movies WHERE franchise_id = ?
           )
           AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
        ).bind(existing.franchise_id, existing.franchise_id, auditId),
      );
    }

    const [auditInsert] = await c.env.DB.batch(statements);
    if (!auditInsert.meta.changes) {
      return c.json({ error: "Watched movies cannot be deleted" }, 409);
    }
    return c.json({ deleted: true, id: movieId });
  });

  app.post("/movies/:id/rate", zValidator("json", ratingInput), async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const input = c.req.valid("json");
    const movie = await getMovie(c.env, movieId);
    if (!movie) return c.json({ error: "Movie not found" }, 404);

    const timestamp = now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO ratings (id, movie_id, recorded_at, watched_at, score, phrase, source, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, 'application', ?)
         ON CONFLICT(movie_id) DO UPDATE SET recorded_at = excluded.recorded_at,
         watched_at = COALESCE(ratings.watched_at, excluded.watched_at), score = excluded.score,
         phrase = excluded.phrase, source = excluded.source, recorded_by = excluded.recorded_by`,
      ).bind(
        newId(),
        movieId,
        timestamp,
        timestamp,
        input.score,
        input.phrase,
        actor.id,
      ),
      c.env.DB.prepare(
        "UPDATE now_showing SET status = 'watched', updated_at = ? WHERE id = 1 AND movie_id = ?",
      ).bind(timestamp, movieId),
      auditStatement(c.env, "movie", movieId, "rated", actor.id, {
        score: input.score,
      }),
    ]);
    return c.json({
      movie: await getMovie(c.env, movieId),
      nowShowing: await getNowShowing(c.env),
    });
  });
};
