import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import type { AppEnv } from "../env";
import {
  getMovie,
  getMovieDetail,
  getNowShowingDetail,
  getPosterReelMovies,
  getRemainingCollectionMovies,
  getWatchedHistory,
  hasRemainingCollectionMovie,
  movieFrom,
  movieSelect,
  type MovieRow,
} from "../db";
import { auditStatement, mutationActor } from "../middleware";
import {
  libraryQueryInput,
  movieEditInput,
  movieInput,
  ratingInput,
} from "../schemas";
import { newId, normalizeTitle, now } from "../env";
import { getTmdbMovie, type TmdbMovieResult } from "../tmdb";
import { replaceTmdbDataStatements } from "../tmdb-data";
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

  app.get("/library", zValidator("query", libraryQueryInput), async (c) => {
    const input = c.req.valid("query");
    const filters: string[] = [];
    const bindings: Array<string | number> = [];
    if (input.status === "watched") filters.push("ratings.id IS NOT NULL");
    if (input.status === "unwatched") filters.push("ratings.id IS NULL");
    if (input.search) {
      const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
      filters.push(`(
        LOWER(movies.title || ' ' || COALESCE(movies.version, '')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(collections.name, '')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(movie_tmdb_data.release_date, movies.release_date, '')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(movies.added_at) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(CAST(ratings.score AS TEXT), '')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(ratings.phrase, '')) LIKE LOWER(?) ESCAPE '\\'
      )`);
      bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const globalCounts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN ratings.id IS NULL THEN 1 ELSE 0 END) AS unwatched
       ${movieFrom}`,
    ).first<{ total: number; unwatched: number | null }>();
    const filteredCounts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total ${movieFrom} ${where}`,
    )
      .bind(...bindings)
      .first<{ total: number }>();
    const total = filteredCounts?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, totalPages);
    const sortExpressions = {
      title: "movies.title COLLATE NOCASE",
      collection: "collections.name COLLATE NOCASE",
      releaseDate:
        "COALESCE(movie_tmdb_data.release_date, movies.release_date)",
      addedAt: "movies.added_at",
      rating: "ratings.score",
    } as const;
    const sortExpression = sortExpressions[input.sort];
    const direction = input.direction === "asc" ? "ASC" : "DESC";
    const nullsLast =
      input.sort === "collection" ||
      input.sort === "releaseDate" ||
      input.sort === "rating"
        ? `${sortExpression} IS NULL ASC, `
        : "";
    const result = await c.env.DB.prepare(
      `${movieSelect} ${where}
       ORDER BY ${nullsLast}${sortExpression} ${direction}, movies.id ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, input.pageSize, (page - 1) * input.pageSize)
      .all<MovieRow>();
    return c.json({
      movies: result.results,
      counts: {
        total: globalCounts?.total ?? 0,
        unwatched: globalCounts?.unwatched ?? 0,
      },
      pagination: { page, pageSize: input.pageSize, total, totalPages },
    });
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
      `${movieSelect}
       WHERE collection_movies.collection_id = ?
       ORDER BY
         CASE WHEN collections.order_confirmed = 1 THEN collection_movies.position END ASC,
         CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
         movies.added_at ASC,
         movies.id ASC`,
    )
      .bind(c.req.param("id"))
      .all<MovieRow>();
    const tmdbCollections = [
      ...new Map(
        movies.results
          .filter(
            (movie) =>
              movie.tmdb_collection_id !== null &&
              movie.tmdb_collection_name !== null,
          )
          .map((movie) => [
            movie.tmdb_collection_id,
            {
              id: movie.tmdb_collection_id!,
              name: movie.tmdb_collection_name!,
            },
          ]),
      ).values(),
    ].sort((left, right) => left.name.localeCompare(right.name));
    return c.json({ collection, movies: movies.results, tmdbCollections });
  });

  app.get("/now-showing", async (c) => {
    const current = await getNowShowingDetail(c.env);
    if (!current) return c.json({ nowShowing: null });
    const remaining = current.collection_id
      ? await getRemainingCollectionMovies(c.env, current.collection_id)
      : [];
    return c.json({
      nowShowing: current,
      remainingCollectionMovies: remaining,
    });
  });

  app.get("/home", async (c) => {
    const nowShowing = await getNowShowingDetail(c.env);
    const [watchedMovies, posterReelMovies, hasNextCollectionMovie] =
      await Promise.all([
        getWatchedHistory(c.env),
        getPosterReelMovies(c.env),
        nowShowing?.collection_id
          ? hasRemainingCollectionMovie(c.env, nowShowing.collection_id)
          : false,
      ]);
    return c.json({
      nowShowing,
      hasNextCollectionMovie,
      watchedMovies,
      posterReelMovies,
    });
  });

  app.get("/movies/:id", async (c) => {
    const movie = await getMovieDetail(c.env, c.req.param("id"));
    return movie
      ? c.json({ movie })
      : c.json({ error: "Movie not found" }, 404);
  });

  app.post("/movies", zValidator("json", movieInput), async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const input = c.req.valid("json");
    const version = input.version ?? null;
    const versionRuntime = input.versionRuntime ?? null;
    const versionReferenceUrl = input.versionReferenceUrl ?? null;
    if (version !== null && !input.tmdbId) {
      return c.json(
        { error: "Select a TMDB movie before specifying a version" },
        400,
      );
    }
    if (
      version === null &&
      (versionRuntime !== null || versionReferenceUrl !== null)
    ) {
      return c.json(
        { error: "Specify a version before adding version details" },
        400,
      );
    }
    if (input.imdbId) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM movies WHERE imdb_id = ?",
      )
        .bind(input.imdbId)
        .first();
      if (duplicate) {
        return c.json(
          { error: "That IMDb movie is already in the catalog" },
          409,
        );
      }
    }
    const id = newId();
    const timestamp = now();
    let tmdbResult: TmdbMovieResult | null = null;
    if (input.tmdbId) {
      try {
        tmdbResult = await getTmdbMovie(c.env, input.tmdbId);
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
    const metadata = tmdbResult?.data ?? null;
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
        release_date, poster_path, runtime_minutes, imdb_id, tmdb_id, tmdb_fetched_at,
        tmdb_collection_id, tmdb_collection_name, version, version_runtime,
        version_reference_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.imdbId ?? null,
        input.tmdbId ?? null,
        tmdbResult?.fetchedAt ?? null,
        metadata?.collection?.id ?? null,
        metadata?.collection?.name ?? null,
        version,
        versionRuntime,
        versionReferenceUrl,
      ),
    );

    if (tmdbResult) {
      statements.push(...replaceTmdbDataStatements(c.env, id, tmdbResult));
    }

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
    return c.json({ movie: await getMovieDetail(c.env, id) }, 201);
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

    if (input.imdbId) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM movies WHERE imdb_id = ? AND id <> ?",
      )
        .bind(input.imdbId, movieId)
        .first();
      if (duplicate) {
        return c.json(
          { error: "That IMDb movie is already in the catalog" },
          409,
        );
      }
    }

    let tmdbResult: TmdbMovieResult | null = null;
    if (input.tmdbId) {
      try {
        tmdbResult = await getTmdbMovie(c.env, input.tmdbId);
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
    const metadata = tmdbResult?.data ?? null;
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
    const tmdbCollectionId = tmdbChangeRequested
      ? (metadata?.collection?.id ?? null)
      : existing.tmdb_collection_id;
    const tmdbCollectionName = tmdbChangeRequested
      ? (metadata?.collection?.name ?? null)
      : existing.tmdb_collection_name;
    const resolvedTmdbId = tmdbChangeRequested
      ? (input.tmdbId ?? null)
      : existing.tmdb_id;
    const resolvedImdbId =
      input.imdbId !== undefined ? input.imdbId : existing.imdb_id;
    const tmdbIdentityChanged =
      tmdbChangeRequested && resolvedTmdbId !== existing.tmdb_id;
    let version =
      input.version !== undefined
        ? input.version
        : tmdbIdentityChanged
          ? null
          : existing.version;
    let versionRuntime =
      input.versionRuntime !== undefined
        ? input.versionRuntime
        : input.version === null || tmdbIdentityChanged
          ? null
          : existing.version_runtime;
    let versionReferenceUrl =
      input.versionReferenceUrl !== undefined
        ? input.versionReferenceUrl
        : input.version === null || tmdbIdentityChanged
          ? null
          : existing.version_reference_url;
    if (resolvedTmdbId === null) {
      const versionDetailsRequested = [
        input.version,
        input.versionRuntime,
        input.versionReferenceUrl,
      ].some((value) => value !== null && value !== undefined);
      if (versionDetailsRequested) {
        return c.json(
          { error: "Select a TMDB movie before specifying a version" },
          400,
        );
      }
      version = null;
      versionRuntime = null;
      versionReferenceUrl = null;
    } else if (
      version === null &&
      (versionRuntime !== null || versionReferenceUrl !== null)
    ) {
      return c.json(
        { error: "Specify a version before adding version details" },
        400,
      );
    }

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
        release_date = ?, poster_path = ?, runtime_minutes = ?, imdb_id = ?, tmdb_id = ?,
        tmdb_collection_id = ?, tmdb_collection_name = ?, version = ?,
        version_runtime = ?, version_reference_url = ?,
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
        resolvedImdbId,
        resolvedTmdbId,
        tmdbCollectionId,
        tmdbCollectionName,
        version,
        versionRuntime,
        versionReferenceUrl,
        tmdbChangeRequested ? 1 : 0,
        tmdbResult?.fetchedAt ?? null,
        movieId,
      ),
    ];

    if (tmdbChangeRequested) {
      statements.push(...replaceTmdbDataStatements(c.env, movieId, tmdbResult));
    }

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
            "UPDATE collections SET updated_at = ? WHERE id = ?",
          ).bind(timestamp, targetCollectionId),
        );
      }
      statements.push(
        c.env.DB.prepare(
          `UPDATE now_showing SET collection_id = ?,
           movie_id = CASE
             WHEN status = 'watched' OR ? IS NULL THEN movie_id
             ELSE COALESCE(
               (SELECT movies.id
                FROM collection_movies
                JOIN movies ON movies.id = collection_movies.movie_id
                LEFT JOIN ratings ON ratings.movie_id = movies.id
                JOIN collections ON collections.id = collection_movies.collection_id
                WHERE collection_movies.collection_id = ? AND ratings.id IS NULL
                ORDER BY
                  CASE WHEN collections.order_confirmed = 1 THEN collection_movies.position END ASC,
                  CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
                  movies.added_at ASC,
                  movies.id ASC
                LIMIT 1),
               movie_id
             )
           END,
           status = CASE
             WHEN status = 'watched' THEN 'watched'
             ELSE 'ready'
           END,
           updated_at = ?
           WHERE id = 1 AND movie_id = ?`,
        ).bind(
          targetCollectionId,
          targetCollectionId,
          targetCollectionId,
          timestamp,
          movieId,
        ),
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
    return c.json({ movie: await getMovieDetail(c.env, movieId) });
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
      c.env.DB.prepare(
        `DELETE FROM tmdb_people
         WHERE NOT EXISTS (
           SELECT 1 FROM movie_credits
           WHERE movie_credits.tmdb_person_id = tmdb_people.tmdb_id
         )`,
      ),
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
      nowShowing: await getNowShowingDetail(c.env),
    });
  });
};
