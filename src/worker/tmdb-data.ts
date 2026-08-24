import type { AppEnv } from "./env";
import {
  CURRENT_TMDB_DATA_VERSION,
  getTmdbMovie,
  TmdbServiceError,
  type TmdbMovieResult,
} from "./tmdb";

const REFRESH_AFTER_MS = 150 * 24 * 60 * 60 * 1000;
const EXPIRES_AFTER_MS = 175 * 24 * 60 * 60 * 1000;
export const DEFAULT_TMDB_REFRESH_BATCH_SIZE = 25;
const PENDING_REFRESH_AT = "1970-01-01T00:00:00.000Z";

const addMilliseconds = (timestamp: string, milliseconds: number) =>
  new Date(new Date(timestamp).getTime() + milliseconds).toISOString();

const currentSnapshotCondition = `EXISTS (
  SELECT 1 FROM movie_tmdb_data
  WHERE movie_id = ? AND tmdb_id = ? AND fetched_at = ?
)`;

export const tmdbOrphanCleanupStatements = (env: AppEnv["Bindings"]) => [
  env.DB.prepare(
    `DELETE FROM tmdb_people
     WHERE NOT EXISTS (
       SELECT 1 FROM movie_credits
       WHERE movie_credits.tmdb_person_id = tmdb_people.tmdb_id
     )`,
  ),
  env.DB.prepare(
    `DELETE FROM tmdb_collections
     WHERE NOT EXISTS (
       SELECT 1 FROM movie_tmdb_data
       WHERE movie_tmdb_data.tmdb_collection_id = tmdb_collections.tmdb_id
     )`,
  ),
];

export const replaceTmdbDataStatements = (
  env: AppEnv["Bindings"],
  movieId: string,
  result: TmdbMovieResult | null,
) => {
  if (!result) {
    return [
      env.DB.prepare("DELETE FROM movie_credits WHERE movie_id = ?").bind(
        movieId,
      ),
      env.DB.prepare("DELETE FROM movie_tmdb_data WHERE movie_id = ?").bind(
        movieId,
      ),
      ...tmdbOrphanCleanupStatements(env),
    ];
  }

  const { data, fetchedAt } = result;
  const refreshAfter = addMilliseconds(fetchedAt, REFRESH_AFTER_MS);
  const expiresAt = addMilliseconds(fetchedAt, EXPIRES_AFTER_MS);
  const statements: D1PreparedStatement[] = [];

  if (data.collection) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO tmdb_collections (tmdb_id, name, fetched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(tmdb_id) DO UPDATE SET
           name = excluded.name,
           fetched_at = excluded.fetched_at
         WHERE excluded.fetched_at >= tmdb_collections.fetched_at`,
      ).bind(data.collection.id, data.collection.name, fetchedAt),
    );
  }

  const people = new Map(
    [...data.cast, ...data.directors].map((person) => [person.id, person]),
  );
  for (const person of people.values()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO tmdb_people (tmdb_id, name, updated_at, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tmdb_id) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at,
           fetched_at = excluded.fetched_at
         WHERE excluded.fetched_at >= COALESCE(
           tmdb_people.fetched_at,
           tmdb_people.updated_at
         )`,
      ).bind(person.id, person.name, fetchedAt, fetchedAt),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, title, release_date, poster_path, runtime_minutes,
        tmdb_collection_id, fetched_at, refresh_after, expires_at, data_version,
        last_refresh_attempt_at, last_refresh_status, last_refresh_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', NULL)
       ON CONFLICT(movie_id) DO UPDATE SET
         tmdb_id = excluded.tmdb_id,
         title = excluded.title,
         release_date = excluded.release_date,
         poster_path = excluded.poster_path,
         runtime_minutes = excluded.runtime_minutes,
         tmdb_collection_id = excluded.tmdb_collection_id,
         fetched_at = excluded.fetched_at,
         refresh_after = excluded.refresh_after,
         expires_at = excluded.expires_at,
         data_version = excluded.data_version,
         last_refresh_attempt_at = excluded.last_refresh_attempt_at,
         last_refresh_status = excluded.last_refresh_status,
         last_refresh_error = excluded.last_refresh_error
       WHERE excluded.fetched_at >= COALESCE(movie_tmdb_data.fetched_at, '')`,
    ).bind(
      movieId,
      data.id,
      data.title,
      data.releaseDate,
      data.posterPath,
      data.runtimeMinutes,
      data.collection?.id ?? null,
      fetchedAt,
      refreshAfter,
      expiresAt,
      CURRENT_TMDB_DATA_VERSION,
      fetchedAt,
    ),
    env.DB.prepare(
      `UPDATE movies SET
         release_date = ?,
         poster_path = ?,
         runtime_minutes = ?,
         tmdb_id = ?,
         tmdb_fetched_at = ?,
         tmdb_collection_id = ?,
         tmdb_collection_name = ?
       WHERE id = ? AND ${currentSnapshotCondition}`,
    ).bind(
      data.releaseDate,
      data.posterPath,
      data.runtimeMinutes,
      data.id,
      fetchedAt,
      data.collection?.id ?? null,
      data.collection?.name ?? null,
      movieId,
      movieId,
      data.id,
      fetchedAt,
    ),
    env.DB.prepare(
      `DELETE FROM movie_credits
       WHERE movie_id = ? AND ${currentSnapshotCondition}`,
    ).bind(movieId, movieId, data.id, fetchedAt),
  );

  for (const [index, person] of data.cast.entries()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO movie_credits
         (movie_id, tmdb_person_id, credit_type, position)
         SELECT ?, ?, 'cast', ? WHERE ${currentSnapshotCondition}`,
      ).bind(movieId, person.id, index + 1, movieId, data.id, fetchedAt),
    );
  }
  for (const [index, person] of data.directors.entries()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO movie_credits
         (movie_id, tmdb_person_id, credit_type, position)
         SELECT ?, ?, 'director', ? WHERE ${currentSnapshotCondition}`,
      ).bind(movieId, person.id, index + 1, movieId, data.id, fetchedAt),
    );
  }
  statements.push(...tmdbOrphanCleanupStatements(env));
  return statements;
};

const seedCompatibilityRows = async (env: AppEnv["Bindings"]) => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tmdb_collections (tmdb_id, name, fetched_at)
       SELECT movies.tmdb_collection_id, movies.tmdb_collection_name,
              COALESCE(movies.tmdb_fetched_at, movies.updated_at)
       FROM movies
       WHERE movies.tmdb_collection_id IS NOT NULL
         AND movies.tmdb_collection_name IS NOT NULL
       ON CONFLICT(tmdb_id) DO UPDATE SET
         name = excluded.name,
         fetched_at = excluded.fetched_at
       WHERE excluded.fetched_at >= tmdb_collections.fetched_at`,
    ),
    env.DB.prepare(
      `DELETE FROM movie_tmdb_data
       WHERE NOT EXISTS (
           SELECT 1 FROM movies
           WHERE movies.id = movie_tmdb_data.movie_id
             AND movies.tmdb_id = movie_tmdb_data.tmdb_id
         )`,
    ),
    env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, title, release_date, poster_path, runtime_minutes,
        tmdb_collection_id, fetched_at, refresh_after, expires_at, data_version)
       SELECT movies.id, movies.tmdb_id, movies.title, movies.release_date,
              movies.poster_path, movies.runtime_minutes,
              movies.tmdb_collection_id, movies.tmdb_fetched_at, ?,
              CASE WHEN movies.tmdb_fetched_at IS NULL THEN NULL
                   ELSE strftime('%Y-%m-%dT%H:%M:%fZ', movies.tmdb_fetched_at, '+175 days')
              END,
              0
       FROM movies
       WHERE movies.tmdb_id IS NOT NULL
       ON CONFLICT(movie_id) DO UPDATE SET
         tmdb_id = excluded.tmdb_id,
         title = excluded.title,
         release_date = excluded.release_date,
         poster_path = excluded.poster_path,
         runtime_minutes = excluded.runtime_minutes,
         tmdb_collection_id = excluded.tmdb_collection_id,
         fetched_at = excluded.fetched_at,
         refresh_after = excluded.refresh_after,
         expires_at = excluded.expires_at,
         data_version = 0
       WHERE excluded.fetched_at > COALESCE(movie_tmdb_data.fetched_at, '')`,
    ).bind(PENDING_REFRESH_AT),
    env.DB.prepare(
      `DELETE FROM movie_credits
       WHERE NOT EXISTS (
         SELECT 1 FROM movie_tmdb_data
         WHERE movie_tmdb_data.movie_id = movie_credits.movie_id
       )`,
    ),
  ]);
};

export type TmdbRefreshReport = {
  attempted: number;
  failed: number;
  refreshed: number;
  rateLimited: boolean;
};

const refreshErrorMessage = (error: TmdbServiceError) =>
  error.status === 429
    ? "TMDB rate limited the refresh"
    : error.status === 503
      ? "TMDB is not configured"
      : "TMDB refresh request failed";

export const countDueTmdbData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM movie_tmdb_data
     WHERE refresh_after <= ? OR data_version < ?`,
  )
    .bind(timestamp, CURRENT_TMDB_DATA_VERSION)
    .first<{ count: number }>();
  return result?.count ?? 0;
};

export const refreshDueTmdbData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
  batchSize = DEFAULT_TMDB_REFRESH_BATCH_SIZE,
): Promise<TmdbRefreshReport> => {
  await seedCompatibilityRows(env);
  const due = await env.DB.prepare(
    `SELECT movie_id, tmdb_id
     FROM movie_tmdb_data
     WHERE refresh_after <= ? OR data_version < ?
     ORDER BY refresh_after, movie_id
     LIMIT ?`,
  )
    .bind(timestamp, CURRENT_TMDB_DATA_VERSION, batchSize)
    .all<{ movie_id: string; tmdb_id: number }>();
  const report: TmdbRefreshReport = {
    attempted: 0,
    failed: 0,
    refreshed: 0,
    rateLimited: false,
  };

  for (const row of due.results) {
    report.attempted += 1;
    await env.DB.prepare(
      `UPDATE movie_tmdb_data SET
         last_refresh_attempt_at = ?,
         last_refresh_status = 'running',
         last_refresh_error = NULL
       WHERE movie_id = ?`,
    )
      .bind(timestamp, row.movie_id)
      .run();
    try {
      const result = await getTmdbMovie(env, row.tmdb_id);
      await env.DB.batch([
        ...replaceTmdbDataStatements(env, row.movie_id, result),
        env.DB.prepare(
          `UPDATE movie_tmdb_data SET
             last_refresh_attempt_at = ?,
             last_refresh_status = 'succeeded',
             last_refresh_error = NULL
           WHERE movie_id = ?`,
        ).bind(timestamp, row.movie_id),
      ]);
      report.refreshed += 1;
    } catch (error) {
      if (!(error instanceof TmdbServiceError)) throw error;
      await env.DB.prepare(
        `UPDATE movie_tmdb_data SET
           last_refresh_attempt_at = ?,
           last_refresh_status = 'failed',
           last_refresh_error = ?
         WHERE movie_id = ?`,
      )
        .bind(timestamp, refreshErrorMessage(error), row.movie_id)
        .run();
      report.failed += 1;
      if (error.status === 429) {
        report.rateLimited = true;
        break;
      }
    }
  }

  await env.DB.batch(tmdbOrphanCleanupStatements(env));
  return report;
};
