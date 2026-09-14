import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import type { AppEnv } from "../env";
import {
  getMovie,
  getMovieDetail,
  getNowShowing,
  getNowShowingDetail,
  getPosterReelMovies,
  getWatchedHistory,
  hasRemainingCollectionMovie,
  movieSelect,
  type MovieRow,
} from "../db";
import { mutationUser } from "../middleware";
import {
  collectionSuggestionQueryInput,
  libraryQueryInput,
  movieEditInput,
  movieInput,
  ratingInput,
} from "../schemas";
import { normalizeCollectionName } from "../../shared/normalize-collection-name";
import { getAuthenticatedUser, newId, now } from "../env";
import { attributionDisplayName } from "../attribution";
import { getTmdbMovie, type TmdbMovieResult } from "../tmdb";
import {
  getTmdbCreditSnapshots,
  replaceTmdbDataStatements,
  tmdbCandidateOrphanCleanupStatements,
} from "../tmdb-data";
import { tmdbErrorResponse } from "./tmdb";
import { literalSubstringSearch, sqliteSearchText } from "../sqlite-search";

type MovieWriteGuard = {
  condition: string;
  bindings: string[];
};

const collectionAppendStatements = (
  env: AppEnv["Bindings"],
  movieId: string,
  collectionName: string,
  timestamp: string,
  userId: string,
  guard?: MovieWriteGuard,
) => {
  const normalizedName = normalizeCollectionName(collectionName);
  const guardBindings = guard?.bindings ?? [];
  return {
    collection: env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_key, created_at, updated_at, created_by, updated_by)
       ${guard ? `SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.condition}` : "VALUES (?, ?, ?, ?, ?, ?, ?)"}
       ON CONFLICT(name_key) DO UPDATE SET
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).bind(
      newId(),
      collectionName,
      normalizedName,
      timestamp,
      timestamp,
      userId,
      userId,
      ...guardBindings,
    ),
    membership: env.DB.prepare(
      `INSERT INTO collection_memberships (collection_id, movie_id, position)
       SELECT collections.id, ?, COALESCE((
         SELECT MAX(position) FROM collection_memberships
         WHERE collection_id = collections.id
       ), 0) + 1
       FROM collections WHERE name_key = ?
       ${guard ? `AND ${guard.condition}` : ""}`,
    ).bind(movieId, normalizedName, ...guardBindings),
  };
};

export const registerMovieRoutes = (app: Hono<AppEnv>) => {
  app.get("/library", zValidator("query", libraryQueryInput), async (c) => {
    const input = c.req.valid("query");
    const filters: string[] = [];
    const bindings: Array<string | number> = [];
    if (input.status === "watched")
      filters.push("ratings.movie_id IS NOT NULL");
    if (input.status === "unwatched") filters.push("ratings.movie_id IS NULL");
    if (input.search) {
      const search = literalSubstringSearch(input.search);
      const fields = [
        "movies.title || ' ' || COALESCE(movies.version, '')",
        "COALESCE(collections.name, '')",
        "COALESCE(movie_tmdb_data.release_date, '')",
        "movies.added_at",
        "COALESCE(CAST(ratings.score AS TEXT), '')",
        "COALESCE(ratings.phrase, '')",
      ];
      filters.push(`(${fields.map(search.condition).join(" OR ")})`);
      bindings.push(...fields.flatMap(() => search.bindings));
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    // Movie/rating triggers keep one dense candidate slot per unwatched movie.
    const globalCounts = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM ratings) AS watched,
        COALESCE((SELECT MAX(slot) FROM roll_candidates), 0) AS unwatched`,
    ).first<{ watched: number; unwatched: number }>();
    const globalUnwatched = globalCounts?.unwatched ?? 0;
    const globalTotal = (globalCounts?.watched ?? 0) + globalUnwatched;
    let total: number;
    if (!input.search) {
      total =
        input.status === "unwatched"
          ? globalUnwatched
          : input.status === "watched"
            ? globalTotal - globalUnwatched
            : globalTotal;
    } else {
      const filteredCounts = await c.env.DB.prepare(
        `SELECT COUNT(*) AS total
         FROM movies
         LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
         LEFT JOIN collection_memberships ON collection_memberships.movie_id = movies.id
         LEFT JOIN collections ON collections.id = collection_memberships.collection_id
         LEFT JOIN ratings ON ratings.movie_id = movies.id
         ${where}`,
      )
        .bind(...bindings)
        .first<{ total: number }>();
      total = filteredCounts?.total ?? 0;
    }
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, totalPages);
    const metadata = {
      counts: { total: globalTotal, unwatched: globalUnwatched },
      pagination: { page, pageSize: input.pageSize, total, totalPages },
    };
    if (total === 0) return c.json({ movies: [], ...metadata });
    const sortExpressions = {
      title: "movies.title COLLATE NOCASE",
      collection: "collections.name COLLATE NOCASE",
      releaseDate: "movie_tmdb_data.release_date",
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
    const needsTmdbData = Boolean(input.search) || input.sort === "releaseDate";
    const needsCollection =
      Boolean(input.search) || input.sort === "collection";
    const needsRatings =
      Boolean(input.search) ||
      input.status !== "all" ||
      input.sort === "rating";
    const pageFrom = `FROM movies
      ${needsTmdbData ? "LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id" : ""}
      ${needsCollection ? "LEFT JOIN collection_memberships ON collection_memberships.movie_id = movies.id" : ""}
      ${needsCollection ? "LEFT JOIN collections ON collections.id = collection_memberships.collection_id" : ""}
      ${needsRatings ? "LEFT JOIN ratings ON ratings.movie_id = movies.id" : ""}`;
    const directTitlePage =
      !input.search && input.status === "all" && input.sort === "title";
    const result = await c.env.DB.prepare(
      directTitlePage
        ? `${movieSelect}
           ORDER BY movies.title COLLATE NOCASE ${direction}, movies.id ASC
           LIMIT ? OFFSET ?`
        : `WITH page AS MATERIALIZED (
             SELECT movies.id
             ${pageFrom}
             ${where}
             ORDER BY ${nullsLast}${sortExpression} ${direction}, movies.id ASC
             LIMIT ? OFFSET ?
           )
           ${movieSelect}
           WHERE movies.id IN (SELECT id FROM page)
           ORDER BY ${nullsLast}${sortExpression} ${direction}, movies.id ASC`,
    )
      .bind(...bindings, input.pageSize, (page - 1) * input.pageSize)
      .all<MovieRow>();
    return c.json({
      movies: result.results,
      ...metadata,
    });
  });

  app.get(
    "/collections/suggestions",
    zValidator("query", collectionSuggestionQueryInput),
    async (c) => {
      const normalizedSearch = normalizeCollectionName(
        c.req.valid("query").search,
      );
      if (!normalizedSearch) return c.json({ collections: [] });
      const search = literalSubstringSearch(normalizedSearch);
      const collections = await c.env.DB.prepare(
        `SELECT id, name
         FROM collections
         WHERE ${search.condition("name_key")}
         ORDER BY
           CASE WHEN name_key = ? THEN 0
                WHEN INSTR(${sqliteSearchText("name_key")}, ?) = 1 THEN 1
                ELSE 2
           END,
           name COLLATE NOCASE,
           id
         LIMIT 8`,
      )
        .bind(...search.bindings, normalizedSearch, normalizedSearch)
        .all<{ id: string; name: string }>();
      return c.json({ collections: collections.results });
    },
  );

  app.get("/collections/:id", async (c) => {
    const user = await getAuthenticatedUser(c.env, c.req.raw);
    const collection = await c.env.DB.prepare(
      user
        ? `SELECT collections.id, collections.name, collections.order_confirmed,
             collections.created_at, collections.updated_at,
             collections.created_by, collections.updated_by,
             creating_user.display_name AS created_by_display_name,
             creating_user.email AS created_by_email,
             updating_user.display_name AS updated_by_display_name,
             updating_user.email AS updated_by_email
           FROM collections
           LEFT JOIN users AS creating_user ON creating_user.id = collections.created_by
           LEFT JOIN users AS updating_user ON updating_user.id = collections.updated_by
           WHERE collections.id = ?`
        : "SELECT id, name, order_confirmed, created_at, updated_at FROM collections WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first<{
        created_at: string;
        created_by?: string | null;
        created_by_display_name?: string | null;
        created_by_email?: string | null;
        id: string;
        name: string;
        order_confirmed: number;
        updated_at: string;
        updated_by?: string | null;
        updated_by_display_name?: string | null;
        updated_by_email?: string | null;
      }>();
    if (!collection) return c.json({ error: "Collection not found" }, 404);

    const movies = await c.env.DB.prepare(
      `${movieSelect}
       WHERE collection_memberships.collection_id = ?
       ORDER BY
         CASE WHEN collections.order_confirmed = 1 THEN collection_memberships.position END ASC,
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
    const publicCollection = {
      id: collection.id,
      name: collection.name,
      order_confirmed: collection.order_confirmed,
      created_at: collection.created_at,
      updated_at: collection.updated_at,
      ...(user
        ? {
            audit: {
              created: {
                at: collection.created_at,
                by: attributionDisplayName(
                  collection.created_by ?? null,
                  collection.created_by_display_name ?? null,
                  collection.created_by_email ?? null,
                ),
              },
              updated: {
                at: collection.updated_at,
                by: attributionDisplayName(
                  collection.updated_by ?? null,
                  collection.updated_by_display_name ?? null,
                  collection.updated_by_email ?? null,
                ),
              },
            },
          }
        : {}),
    };
    return c.json({
      collection: publicCollection,
      movies: movies.results,
      tmdbCollections,
    });
  });

  app.get("/home", async (c) => {
    const user = await getAuthenticatedUser(c.env, c.req.raw);
    const selection = await getNowShowing(c.env);
    const [
      nowShowing,
      watchedMovies,
      posterReelMovies,
      hasNextCollectionMovie,
    ] = await Promise.all([
      getNowShowingDetail(c.env, Boolean(user), selection),
      getWatchedHistory(c.env),
      getPosterReelMovies(c.env),
      selection?.movie_id &&
      selection.rating_score !== null &&
      selection.collection_id
        ? hasRemainingCollectionMovie(c.env, selection.collection_id)
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
    const user = await getAuthenticatedUser(c.env, c.req.raw);
    const movie = await getMovieDetail(c.env, c.req.param("id"), Boolean(user));
    return movie
      ? c.json({ movie })
      : c.json({ error: "Movie not found" }, 404);
  });

  app.post("/movies", zValidator("json", movieInput), async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

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
        "SELECT movie_id FROM movie_tmdb_data WHERE tmdb_id = ?",
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
    const collectionAppend = input.collectionName
      ? collectionAppendStatements(
          c.env,
          id,
          input.collectionName,
          timestamp,
          user.id,
        )
      : null;
    const statements: D1PreparedStatement[] = [];
    if (collectionAppend) statements.push(collectionAppend.collection);

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO movies
         (id, title, added_at, imdb_id, added_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        title,
        timestamp,
        input.imdbId ?? null,
        user.id,
        timestamp,
        user.id,
      ),
    );

    if (tmdbResult) {
      statements.push(
        ...(await replaceTmdbDataStatements(c.env, id, tmdbResult, {
          attributedBy: user.id,
          existingCollectionId: null,
          existingCredits: [],
          updatedAt: timestamp,
        })),
      );
      if (version !== null) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE movies SET
               version = ?,
               version_runtime = ?,
               version_reference_url = ?
             WHERE id = ?`,
          ).bind(version, versionRuntime, versionReferenceUrl, id),
        );
      }
    }

    if (collectionAppend) statements.push(collectionAppend.membership);
    await c.env.DB.batch(statements);
    return c.json({ movie: await getMovieDetail(c.env, id, true) }, 201);
  });

  app.patch("/movies/:id", zValidator("json", movieEditInput), async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

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
        `SELECT movie_id FROM movie_tmdb_data
         WHERE tmdb_id = ? AND movie_id <> ?`,
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
    const tmdbChangeRequested = input.tmdbId !== undefined;
    const resolvedTmdbId = tmdbChangeRequested
      ? (input.tmdbId ?? null)
      : existing.tmdb_id;
    const tmdbIdentityChanged =
      tmdbChangeRequested && resolvedTmdbId !== existing.tmdb_id;
    const version =
      input.version !== undefined
        ? input.version
        : tmdbIdentityChanged
          ? null
          : existing.version;
    const versionRuntime =
      input.versionRuntime !== undefined
        ? input.versionRuntime
        : input.version === null || tmdbIdentityChanged
          ? null
          : existing.version_runtime;
    const versionReferenceUrl =
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
    const collectionChangeRequested = input.collectionName !== undefined;
    if (collectionChangeRequested) {
      targetCollectionName = input.collectionName || null;
      if (!targetCollectionName) {
        targetCollectionId = null;
      } else if (
        existing.collection_id &&
        normalizeCollectionName(targetCollectionName) ===
          normalizeCollectionName(existing.collection_name ?? "")
      ) {
        targetCollectionId = existing.collection_id;
      } else {
        const target = await c.env.DB.prepare(
          "SELECT id FROM collections WHERE name_key = ?",
        )
          .bind(normalizeCollectionName(targetCollectionName))
          .first<{ id: string }>();
        targetCollectionId = target?.id ?? newId();
      }
    }

    const membershipChanged =
      collectionChangeRequested &&
      targetCollectionId !== existing.collection_id;

    // This predicate stays stable throughout an unconfirmed-title batch,
    // which never changes the TMDB link. Every side effect uses the same guard.
    const titleGuard: MovieWriteGuard | undefined =
      input.title !== undefined && !tmdbChangeRequested
        ? {
            condition: `EXISTS (
              SELECT 1 FROM movies AS current_movie
              LEFT JOIN movie_tmdb_data AS current_tmdb
                ON current_tmdb.movie_id = current_movie.id
              WHERE current_movie.id = ?
                AND (current_tmdb.movie_id IS NULL OR current_movie.title = ?)
            )`,
            bindings: [movieId, input.title],
          }
        : undefined;
    const guardCondition = titleGuard ? `AND ${titleGuard.condition}` : "";
    const guardBindings = titleGuard?.bindings ?? [];
    const assignments = ["updated_at = ?", "updated_by = ?"];
    const values: Array<string | number | null> = [timestamp, user.id];
    const assign = (
      column:
        | "title"
        | "imdb_id"
        | "version"
        | "version_runtime"
        | "version_reference_url",
      value: string | number | null,
    ) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (metadata || input.title !== undefined) {
      assign("title", metadata?.title ?? input.title!);
    }
    if (input.imdbId !== undefined) assign("imdb_id", input.imdbId);
    if (input.version !== undefined) assign("version", input.version);
    if (input.versionRuntime !== undefined || input.version === null) {
      assign("version_runtime", input.versionRuntime ?? null);
    }
    if (input.versionReferenceUrl !== undefined || input.version === null) {
      assign("version_reference_url", input.versionReferenceUrl ?? null);
    }
    const updateMovie = c.env.DB.prepare(
      `UPDATE movies SET ${assignments.join(", ")} WHERE id = ? ${guardCondition}`,
    ).bind(...values, movieId, ...guardBindings);
    const replaceTmdb = tmdbChangeRequested
      ? await replaceTmdbDataStatements(c.env, movieId, tmdbResult, {
          attributedBy: user.id,
          existingCollectionId: existing.tmdb_collection_id,
          existingCredits: existing.tmdb_id === null ? [] : undefined,
          updatedAt: timestamp,
        })
      : [];
    const statements: D1PreparedStatement[] = [];
    if (tmdbResult) {
      // Clear version defaults against the current identity before replacing it;
      // explicit version fields are applied after the requested link exists.
      statements.push(
        c.env.DB.prepare(
          `UPDATE movies SET
             version = NULL, version_runtime = NULL, version_reference_url = NULL
           WHERE id = ? AND version IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM movie_tmdb_data
               WHERE movie_id = movies.id AND tmdb_id = ?
             )`,
        ).bind(movieId, tmdbResult.data.id),
        ...replaceTmdb,
        updateMovie,
      );
    } else {
      statements.push(updateMovie, ...replaceTmdb);
    }

    if (membershipChanged) {
      const collectionAppend = targetCollectionName
        ? collectionAppendStatements(
            c.env,
            movieId,
            targetCollectionName,
            timestamp,
            user.id,
            titleGuard,
          )
        : null;
      if (collectionAppend) statements.push(collectionAppend.collection);
      if (existing.collection_id) {
        statements.push(
          c.env.DB.prepare(
            `DELETE FROM collection_memberships WHERE collection_id = ? AND movie_id = ? ${guardCondition}`,
          ).bind(existing.collection_id, movieId, ...guardBindings),
        );
      }
      if (collectionAppend) statements.push(collectionAppend.membership);
      statements.push(
        c.env.DB.prepare(
          `WITH replacement AS (
             SELECT movies.id
             FROM collection_memberships
             JOIN movies ON movies.id = collection_memberships.movie_id
             LEFT JOIN ratings ON ratings.movie_id = movies.id
             JOIN collections ON collections.id = collection_memberships.collection_id
             WHERE collection_memberships.collection_id = (
               SELECT collection_id FROM collection_memberships WHERE movie_id = ?
             ) AND ratings.movie_id IS NULL
             ORDER BY
               CASE WHEN collections.order_confirmed = 1 THEN collection_memberships.position END ASC,
               CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
               movies.added_at ASC,
               movies.id ASC
             LIMIT 1
           )
           UPDATE now_showing
           SET rolled_at = CASE
                 WHEN movie_id <> COALESCE((SELECT id FROM replacement), movie_id)
                   THEN ?
                 ELSE rolled_at
               END,
               rolled_by = CASE
                 WHEN movie_id <> COALESCE((SELECT id FROM replacement), movie_id)
                   THEN ?
                 ELSE rolled_by
               END,
               movie_id = COALESCE((SELECT id FROM replacement), movie_id)
           WHERE id = 1 AND EXISTS (
               SELECT 1 FROM collection_memberships WHERE movie_id = ?
             ) AND movie_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
             ) ${guardCondition}`,
        ).bind(movieId, timestamp, user.id, movieId, movieId, ...guardBindings),
      );
      if (existing.collection_id) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE collections SET updated_at = ?, updated_by = ? WHERE id = ? ${guardCondition}`,
          ).bind(timestamp, user.id, existing.collection_id, ...guardBindings),
          c.env.DB.prepare(
            `DELETE FROM collections WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM collection_memberships WHERE collection_id = ?
             ) ${guardCondition}`,
          ).bind(
            existing.collection_id,
            existing.collection_id,
            ...guardBindings,
          ),
        );
      }
    }

    try {
      const results = await c.env.DB.batch(statements);
      if (titleGuard && results[0].meta.changes === 0) {
        return c.json(
          {
            error:
              "The movie's TMDB match changed. Reload and confirm or remove the match before changing the title.",
          },
          409,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Movie version requires a TMDB link") ||
          /CHECK constraint failed: version_(runtime|reference_url)\b/.test(
            error.message,
          ))
      ) {
        return c.json(
          {
            error:
              "The movie's TMDB match or version changed. Reload and try again.",
          },
          409,
        );
      }
      throw error;
    }
    return c.json({ movie: await getMovieDetail(c.env, movieId, true) });
  });

  app.delete("/movies/:id", async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const existing = await getMovie(c.env, movieId);
    if (!existing) return c.json({ error: "Movie not found" }, 404);
    if (existing.rating_score !== null) {
      return c.json({ error: "Watched movies cannot be deleted" }, 409);
    }

    const timestamp = now();
    const existingCredits =
      existing.tmdb_id === null
        ? []
        : ((await getTmdbCreditSnapshots(c.env, [movieId])).get(movieId) ?? []);
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = NULL, rolled_at = NULL, rolled_by = NULL
         WHERE id = 1 AND movie_id = ?
           AND EXISTS (
             SELECT 1 FROM movies
             LEFT JOIN ratings ON ratings.movie_id = movies.id
             WHERE movies.id = ? AND ratings.movie_id IS NULL
           )`,
      ).bind(movieId, movieId),
      c.env.DB.prepare(
        `DELETE FROM movies WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM ratings WHERE movie_id = ?)`,
      ).bind(movieId, movieId),
      ...tmdbCandidateOrphanCleanupStatements(c.env, {
        collectionIds:
          existing.tmdb_collection_id === null
            ? []
            : [existing.tmdb_collection_id],
        personIds: existingCredits.map((credit) => credit.personId),
      }),
    ];
    if (existing.collection_id) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE collections
           SET updated_at = ?, updated_by = ?
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM collection_memberships WHERE collection_id = ?
             )`,
        ).bind(
          timestamp,
          user.id,
          existing.collection_id,
          existing.collection_id,
        ),
        c.env.DB.prepare(
          `DELETE FROM collections WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM collection_memberships WHERE collection_id = ?
           )`,
        ).bind(existing.collection_id, existing.collection_id),
      );
    }

    const results = await c.env.DB.batch(statements);
    const movieDelete = results[1];
    if (!movieDelete?.meta.changes) {
      return c.json({ error: "Watched movies cannot be deleted" }, 409);
    }
    return c.json({ deleted: true, id: movieId });
  });

  app.post("/movies/:id/rate", zValidator("json", ratingInput), async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const movieId = c.req.param("id");
    const input = c.req.valid("json");
    const movie = await getMovie(c.env, movieId);
    if (!movie) return c.json({ error: "Movie not found" }, 404);

    const timestamp = now();
    await c.env.DB.prepare(
      `INSERT INTO ratings
       (movie_id, watched_at, score, phrase, recorded_at, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(movie_id) DO UPDATE SET
       score = excluded.score,
       phrase = excluded.phrase,
       recorded_at = excluded.recorded_at,
       recorded_by = excluded.recorded_by`,
    )
      .bind(movieId, timestamp, input.score, input.phrase, timestamp, user.id)
      .run();
    return c.json({
      movie: await getMovie(c.env, movieId),
      nowShowing: await getNowShowingDetail(c.env, true),
    });
  });
};
