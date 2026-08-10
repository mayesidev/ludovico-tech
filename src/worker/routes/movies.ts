import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import type { AppEnv } from "../env";
import {
  getMovie,
  getNowShowing,
  getRemainingCollectionMovies,
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

  app.get("/collections", async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT collections.*, COUNT(movies.id) AS movie_count,
      SUM(CASE WHEN ratings.id IS NOT NULL THEN 1 ELSE 0 END) AS watched_count
     FROM collections
     LEFT JOIN collection_movies ON collection_movies.collection_id = collections.id
     LEFT JOIN movies ON movies.id = collection_movies.movie_id
     LEFT JOIN ratings ON ratings.movie_id = movies.id
     GROUP BY collections.id ORDER BY collections.name COLLATE NOCASE`,
    ).all();
    return c.json({ collections: result.results });
  });

  app.get("/collections/:id", async (c) => {
    const collection = await c.env.DB.prepare(
      "SELECT id, name, order_confirmed, created_at, updated_at FROM collections WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();
    if (!collection) return c.json({ error: "Collection not found" }, 404);

    const movies = await c.env.DB.prepare(
      `${movieSelect} WHERE collection_movies.collection_id = ? ORDER BY collection_movies.position ASC`,
    )
      .bind(c.req.param("id"))
      .all<MovieRow>();
    return c.json({ collection, movies: movies.results });
  });

  app.get("/now-showing", async (c) => {
    const current = await getNowShowing(c.env);
    if (!current) return c.json({ nowShowing: null });
    const remaining = current.collection_id
      ? await getRemainingCollectionMovies(c.env, current.collection_id)
      : [];
    return c.json({
      nowShowing: current,
      remainingCollectionMovies: remaining,
    });
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
    let collectionId: string | null = null;
    const statements: D1PreparedStatement[] = [];

    if (input.collectionName) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM collections WHERE name_normalized = ?",
      )
        .bind(normalizeTitle(input.collectionName))
        .first<{ id: string }>();
      collectionId = existing?.id ?? newId();
      if (!existing) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO collections (id, name, name_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(
            collectionId,
            input.collectionName,
            normalizeTitle(input.collectionName),
            timestamp,
            timestamp,
          ),
        );
      }
    }

    const position = collectionId
      ? ((
          await c.env.DB.prepare(
            "SELECT COALESCE(MAX(position), 0) AS max_position FROM collection_movies WHERE collection_id = ?",
          )
            .bind(collectionId)
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

    if (collectionId && position !== null) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
        ).bind(collectionId, id, position),
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

    let targetCollectionId = existing.collection_id;
    let targetCollectionName: string | null = null;
    let createCollection = false;
    const collectionChangeRequested = input.collectionName !== undefined;
    if (collectionChangeRequested) {
      targetCollectionName = input.collectionName || null;
      if (!targetCollectionName) {
        targetCollectionId = null;
      } else if (
        existing.collection_id &&
        normalizeTitle(targetCollectionName) ===
          normalizeTitle(existing.collection_name ?? "")
      ) {
        targetCollectionId = existing.collection_id;
      } else {
        const target = await c.env.DB.prepare(
          "SELECT id FROM collections WHERE name_normalized = ?",
        )
          .bind(normalizeTitle(targetCollectionName))
          .first<{ id: string }>();
        targetCollectionId = target?.id ?? newId();
        createCollection = !target;
      }
    }

    const membershipChanged =
      collectionChangeRequested &&
      targetCollectionId !== existing.collection_id;
    const targetPosition =
      membershipChanged && targetCollectionId
        ? ((
            await c.env.DB.prepare(
              "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM collection_movies WHERE collection_id = ?",
            )
              .bind(targetCollectionId)
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
      if (createCollection && targetCollectionId && targetCollectionName) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO collections (id, name, name_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(
            targetCollectionId,
            targetCollectionName,
            normalizeTitle(targetCollectionName),
            timestamp,
            timestamp,
          ),
        );
      }
      if (existing.collection_id) {
        statements.push(
          c.env.DB.prepare(
            "DELETE FROM collection_movies WHERE collection_id = ? AND movie_id = ?",
          ).bind(existing.collection_id, movieId),
        );
      }
      if (targetCollectionId && targetPosition !== null) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
          ).bind(targetCollectionId, movieId, targetPosition),
          c.env.DB.prepare(
            "UPDATE collections SET order_confirmed = 0, updated_at = ? WHERE id = ?",
          ).bind(timestamp, targetCollectionId),
        );
      }
      statements.push(
        c.env.DB.prepare(
          `UPDATE now_showing SET collection_id = ?,
           status = CASE
             WHEN status = 'watched' THEN 'watched'
             WHEN ? IS NULL THEN 'ready'
             ELSE 'pending_order'
           END,
           updated_at = ?
           WHERE id = 1 AND movie_id = ?`,
        ).bind(targetCollectionId, targetCollectionId, timestamp, movieId),
      );
      if (existing.collection_id) {
        statements.push(
          c.env.DB.prepare(
            "UPDATE collections SET updated_at = ? WHERE id = ?",
          ).bind(timestamp, existing.collection_id),
          c.env.DB.prepare(
            `DELETE FROM collections WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM collection_movies WHERE collection_id = ?
             )`,
          ).bind(existing.collection_id, existing.collection_id),
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
         SET rolled_movie_id = NULL, movie_id = NULL, collection_id = NULL,
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
    if (existing.collection_id) {
      statements.push(
        c.env.DB.prepare(
          `DELETE FROM collections WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM collection_movies WHERE collection_id = ?
           )
           AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)`,
        ).bind(existing.collection_id, existing.collection_id, auditId),
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
