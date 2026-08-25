import type { AppEnv } from "./env";
import {
  fetchTmdbMovie,
  getTmdbMovieCacheKey,
  readTmdbMovieCacheBatch,
  tmdbMovieCachePersistenceStatements,
  TmdbServiceError,
  type TmdbMovieCacheLookup,
  type TmdbMovieResult,
} from "./tmdb";
import {
  getTmdbMetadataContractId,
  tmdbMovieDetailSchema,
} from "../shared/tmdb-metadata-contract";

const REFRESH_AFTER_MS = 150 * 24 * 60 * 60 * 1000;
const EXPIRES_AFTER_MS = 175 * 24 * 60 * 60 * 1000;
export const DEFAULT_TMDB_REFRESH_BATCH_SIZE = 25;
const TMDB_FETCH_CONCURRENCY = 6;

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

const uniqueIds = (ids: number[]) => [...new Set(ids)];

export const tmdbCandidateOrphanCleanupStatements = (
  env: AppEnv["Bindings"],
  candidates: { collectionIds: number[]; personIds: number[] },
) => {
  const personIds = uniqueIds(candidates.personIds);
  const collectionIds = uniqueIds(candidates.collectionIds);
  const statements: D1PreparedStatement[] = [];
  if (personIds.length > 0) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM tmdb_people
         WHERE tmdb_id IN (${personIds.map(() => "?").join(", ")})
           AND NOT EXISTS (
             SELECT 1 FROM movie_credits
             WHERE movie_credits.tmdb_person_id = tmdb_people.tmdb_id
           )`,
      ).bind(...personIds),
    );
  }
  if (collectionIds.length > 0) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM tmdb_collections
         WHERE tmdb_id IN (${collectionIds.map(() => "?").join(", ")})
           AND NOT EXISTS (
             SELECT 1 FROM movie_tmdb_data
             WHERE movie_tmdb_data.tmdb_collection_id = tmdb_collections.tmdb_id
           )`,
      ).bind(...collectionIds),
    );
  }
  return statements;
};

export const purgeExpiredTmdbData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const expired = await env.DB.prepare(
    `SELECT movie_id, tmdb_collection_id
     FROM movie_tmdb_data
     WHERE expires_at IS NOT NULL
       AND expires_at <= ?
       AND expired_at IS NULL
     ORDER BY expires_at, movie_id
     LIMIT (
       SELECT batch_size FROM tmdb_refresh_schedule WHERE id = 1
     )`,
  )
    .bind(timestamp)
    .all<{ movie_id: string; tmdb_collection_id: number | null }>();
  const movieIds = expired.results.map((row) => row.movie_id);
  if (movieIds.length === 0) return 0;

  const creditSnapshots = await getTmdbCreditSnapshots(env, movieIds);
  const orphanCandidates = {
    collectionIds: expired.results.flatMap((row) =>
      row.tmdb_collection_id === null ? [] : [row.tmdb_collection_id],
    ),
    personIds: movieIds.flatMap((movieId) =>
      (creditSnapshots.get(movieId) ?? []).map((credit) => credit.personId),
    ),
  };
  const placeholders = movieIds.map(() => "?").join(", ");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE movie_tmdb_data SET
         title = NULL,
         release_date = NULL,
         poster_path = NULL,
         runtime_minutes = NULL,
         tmdb_collection_id = NULL,
         expired_at = ?
       WHERE movie_id IN (${placeholders})
         AND expires_at IS NOT NULL
         AND expires_at <= ?
         AND expired_at IS NULL`,
    ).bind(timestamp, ...movieIds, timestamp),
    env.DB.prepare(
      `DELETE FROM movie_credits
       WHERE movie_id IN (${placeholders})
         AND EXISTS (
           SELECT 1 FROM movie_tmdb_data
           WHERE movie_tmdb_data.movie_id = movie_credits.movie_id
             AND movie_tmdb_data.expired_at = ?
         )`,
    ).bind(...movieIds, timestamp),
    ...tmdbCandidateOrphanCleanupStatements(env, orphanCandidates),
  ]);
  return movieIds.length;
};

export type TmdbCreditSnapshot = {
  creditType: "cast" | "director";
  personId: number;
  position: number;
};

export const getTmdbCreditSnapshots = async (
  env: AppEnv["Bindings"],
  movieIds: string[],
) => {
  const snapshots = new Map<string, TmdbCreditSnapshot[]>(
    movieIds.map((movieId) => [movieId, []]),
  );
  if (movieIds.length === 0) return snapshots;
  const rows = await env.DB.prepare(
    `SELECT movie_id, tmdb_person_id, credit_type, position
     FROM movie_credits
     WHERE movie_id IN (${movieIds.map(() => "?").join(", ")})
     ORDER BY movie_id, credit_type, position`,
  )
    .bind(...movieIds)
    .all<{
      credit_type: "cast" | "director";
      movie_id: string;
      position: number;
      tmdb_person_id: number;
    }>();
  for (const row of rows.results) {
    snapshots.get(row.movie_id)?.push({
      creditType: row.credit_type,
      personId: row.tmdb_person_id,
      position: row.position,
    });
  }
  return snapshots;
};

const creditSnapshotKey = (credit: TmdbCreditSnapshot) =>
  `${credit.creditType}:${credit.position}:${credit.personId}`;

export const replaceTmdbDataStatements = async (
  env: AppEnv["Bindings"],
  movieId: string,
  result: TmdbMovieResult | null,
  options: {
    existingCredits?: TmdbCreditSnapshot[];
    includeOrphanCleanup?: boolean;
  } = {},
) => {
  const includeOrphanCleanup = options.includeOrphanCleanup ?? true;
  if (!result) {
    return [
      env.DB.prepare("DELETE FROM movie_credits WHERE movie_id = ?").bind(
        movieId,
      ),
      env.DB.prepare("DELETE FROM movie_tmdb_data WHERE movie_id = ?").bind(
        movieId,
      ),
      ...(includeOrphanCleanup ? tmdbOrphanCleanupStatements(env) : []),
    ];
  }

  const data = tmdbMovieDetailSchema.parse(result.data);
  const { fetchedAt } = result;
  const contractId = await getTmdbMetadataContractId();
  const refreshAfter = addMilliseconds(fetchedAt, REFRESH_AFTER_MS);
  const expiresAt = addMilliseconds(fetchedAt, EXPIRES_AFTER_MS);
  const existingCredits =
    options.existingCredits ??
    (await getTmdbCreditSnapshots(env, [movieId])).get(movieId) ??
    [];
  const desiredCredits: TmdbCreditSnapshot[] = [
    ...data.cast.map((person, index) => ({
      creditType: "cast" as const,
      personId: person.id,
      position: index + 1,
    })),
    ...data.directors.map((person, index) => ({
      creditType: "director" as const,
      personId: person.id,
      position: index + 1,
    })),
  ];
  const existingCreditKeys = new Set(existingCredits.map(creditSnapshotKey));
  const desiredCreditKeys = new Set(desiredCredits.map(creditSnapshotKey));
  const preservedCredits = existingCredits.filter((credit) =>
    desiredCreditKeys.has(creditSnapshotKey(credit)),
  );
  const creditsToInsert = desiredCredits.filter(
    (credit) => !existingCreditKeys.has(creditSnapshotKey(credit)),
  );
  const creditsNeedDelete = existingCredits.some(
    (credit) => !desiredCreditKeys.has(creditSnapshotKey(credit)),
  );
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
        `INSERT INTO tmdb_people (tmdb_id, name, fetched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(tmdb_id) DO UPDATE SET
           name = excluded.name,
           fetched_at = excluded.fetched_at
         WHERE excluded.fetched_at >= tmdb_people.fetched_at`,
      ).bind(person.id, person.name, fetchedAt),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, title, release_date, poster_path, runtime_minutes,
        tmdb_collection_id, fetched_at, refresh_after, expires_at, contract_id,
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
         contract_id = excluded.contract_id,
         last_refresh_attempt_at = excluded.last_refresh_attempt_at,
         last_refresh_status = excluded.last_refresh_status,
         last_refresh_error = excluded.last_refresh_error,
         expired_at = NULL
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
      contractId,
      fetchedAt,
    ),
  );

  if (creditsNeedDelete) {
    const preserveCondition = preservedCredits
      .map(() => "(credit_type = ? AND tmdb_person_id = ? AND position = ?)")
      .join(" OR ");
    statements.push(
      env.DB.prepare(
        `DELETE FROM movie_credits
         WHERE movie_id = ? AND ${currentSnapshotCondition}
         ${preserveCondition ? `AND NOT (${preserveCondition})` : ""}`,
      ).bind(
        movieId,
        movieId,
        data.id,
        fetchedAt,
        ...preservedCredits.flatMap((credit) => [
          credit.creditType,
          credit.personId,
          credit.position,
        ]),
      ),
    );
  }

  for (const credit of creditsToInsert) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO movie_credits
         (movie_id, tmdb_person_id, credit_type, position)
         SELECT ?, ?, ?, ? WHERE ${currentSnapshotCondition}`,
      ).bind(
        movieId,
        credit.personId,
        credit.creditType,
        credit.position,
        movieId,
        data.id,
        fetchedAt,
      ),
    );
  }
  if (includeOrphanCleanup) {
    statements.push(...tmdbOrphanCleanupStatements(env));
  }
  return statements;
};

export type TmdbRefreshReport = {
  attempted: number;
  failed: number;
  haltedReason?: string;
  refreshed: number;
  rateLimited: boolean;
};

type TmdbFetchOutcome =
  | { lookup: TmdbMovieCacheLookup; result: TmdbMovieResult }
  | { error: TmdbServiceError; lookup: TmdbMovieCacheLookup };

const refreshErrorMessage = (error: TmdbServiceError) => {
  const upstreamStatus = error.upstreamStatus
    ? ` (HTTP ${error.upstreamStatus})`
    : "";
  switch (error.kind) {
    case "authentication":
      return `TMDB credentials were rejected${upstreamStatus}`;
    case "configuration":
      return "TMDB is not configured";
    case "invalid_response":
      return "TMDB returned an invalid response";
    case "network":
      return "TMDB could not be reached";
    case "not_found":
      return `TMDB title was not found${upstreamStatus}`;
    case "provider_rejected":
      return `TMDB rejected the refresh request${upstreamStatus}`;
    case "provider_unavailable":
      return `TMDB is temporarily unavailable${upstreamStatus}`;
    case "rate_limited":
      return "TMDB rate limited the refresh";
  }
};

export const countDueTmdbData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const contractId = await getTmdbMetadataContractId();
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM movie_tmdb_data
     WHERE contract_id IS NULL
        OR contract_id < ?
        OR contract_id > ?
        OR (contract_id = ? AND refresh_after <= ?)`,
  )
    .bind(contractId, contractId, contractId, timestamp)
    .first<{ count: number }>();
  return result?.count ?? 0;
};

export const refreshDueTmdbData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
  batchSize = DEFAULT_TMDB_REFRESH_BATCH_SIZE,
): Promise<TmdbRefreshReport> => {
  const contractId = await getTmdbMetadataContractId();
  const due = await env.DB.prepare(
    `SELECT movie_id, tmdb_id, tmdb_collection_id
     FROM movie_tmdb_data
     WHERE refresh_after <= ? OR contract_id IS NULL OR contract_id <> ?
     ORDER BY refresh_after, movie_id
     LIMIT ?`,
  )
    .bind(timestamp, contractId, batchSize)
    .all<{
      movie_id: string;
      tmdb_collection_id: number | null;
      tmdb_id: number;
    }>();
  const report: TmdbRefreshReport = {
    attempted: 0,
    failed: 0,
    refreshed: 0,
    rateLimited: false,
  };

  const tmdbIds = [...new Set(due.results.map((row) => row.tmdb_id))];
  const lookups: TmdbMovieCacheLookup[] = await Promise.all(
    tmdbIds.map(async (tmdbId) => ({
      cacheKey: await getTmdbMovieCacheKey(contractId, tmdbId),
      tmdbId,
    })),
  );
  const cached = await readTmdbMovieCacheBatch(env, lookups, timestamp);
  const creditSnapshots = await getTmdbCreditSnapshots(
    env,
    due.results.map((row) => row.movie_id),
  );

  const fetched = new Map<number, TmdbMovieResult>();
  const failures = new Map<number, TmdbServiceError>();
  const sharedFailureIds = new Set<number>();
  const misses = lookups.filter((lookup) => !cached.results.has(lookup.tmdbId));
  for (
    let offset = 0;
    offset < misses.length && !report.rateLimited && !report.haltedReason;
    offset += TMDB_FETCH_CONCURRENCY
  ) {
    const chunk = misses.slice(offset, offset + TMDB_FETCH_CONCURRENCY);
    const outcomes: TmdbFetchOutcome[] = await Promise.all(
      chunk.map(async (lookup) => {
        try {
          return {
            lookup,
            result: await fetchTmdbMovie(env, lookup.tmdbId),
          };
        } catch (error) {
          if (!(error instanceof TmdbServiceError)) throw error;
          return { error, lookup };
        }
      }),
    );
    for (const outcome of outcomes) {
      if ("result" in outcome) {
        fetched.set(outcome.lookup.tmdbId, outcome.result);
      } else {
        failures.set(outcome.lookup.tmdbId, outcome.error);
        if (outcome.error.status === 429) {
          report.rateLimited = true;
          sharedFailureIds.add(outcome.lookup.tmdbId);
        }
      }
    }
    const chunkFailures = outcomes.flatMap((outcome) =>
      "error" in outcome ? [outcome.error] : [],
    );
    const sharedFailure =
      chunkFailures.length === outcomes.length &&
      chunkFailures.every((error) => error.batchScoped);
    if (sharedFailure) {
      const error = chunkFailures[0];
      for (const outcome of outcomes) {
        if ("error" in outcome) sharedFailureIds.add(outcome.lookup.tmdbId);
      }
      if (!report.rateLimited) {
        report.haltedReason = refreshErrorMessage(error);
      }
      console.error("TMDB refresh batch halted", {
        diagnostic: error.diagnostic,
        failureKind: error.kind,
        upstreamStatus: error.upstreamStatus,
      });
    }
  }

  const persistenceStatements = tmdbMovieCachePersistenceStatements(
    env,
    lookups.flatMap((lookup) => {
      const result = fetched.get(lookup.tmdbId);
      return result ? [{ ...lookup, result }] : [];
    }),
    cached.invalidKeys,
    timestamp,
  );
  const orphanCandidates = {
    collectionIds: [] as number[],
    personIds: [] as number[],
  };

  for (const row of due.results) {
    const result = cached.results.get(row.tmdb_id) ?? fetched.get(row.tmdb_id);
    const failure = failures.get(row.tmdb_id);
    if (result) {
      const desiredPersonIds = new Set(
        [...result.data.cast, ...result.data.directors].map(
          (person) => person.id,
        ),
      );
      orphanCandidates.personIds.push(
        ...(creditSnapshots.get(row.movie_id) ?? [])
          .map((credit) => credit.personId)
          .filter((personId) => !desiredPersonIds.has(personId)),
      );
      if (
        row.tmdb_collection_id !== null &&
        row.tmdb_collection_id !== (result.data.collection?.id ?? null)
      ) {
        orphanCandidates.collectionIds.push(row.tmdb_collection_id);
      }
      report.attempted += 1;
      report.refreshed += 1;
      persistenceStatements.push(
        ...(await replaceTmdbDataStatements(env, row.movie_id, result, {
          existingCredits: creditSnapshots.get(row.movie_id) ?? [],
          includeOrphanCleanup: false,
        })),
        env.DB.prepare(
          `UPDATE movie_tmdb_data SET
             last_refresh_attempt_at = ?,
             last_refresh_status = 'succeeded',
             last_refresh_error = NULL
           WHERE movie_id = ?`,
        ).bind(timestamp, row.movie_id),
      );
    } else if (failure) {
      report.attempted += 1;
      report.failed += 1;
      if (sharedFailureIds.has(row.tmdb_id)) continue;
      persistenceStatements.push(
        env.DB.prepare(
          `UPDATE movie_tmdb_data SET
             last_refresh_attempt_at = ?,
             last_refresh_status = 'failed',
             last_refresh_error = ?,
             refresh_after = ?
           WHERE movie_id = ?`,
        ).bind(
          timestamp,
          refreshErrorMessage(failure),
          timestamp,
          row.movie_id,
        ),
      );
    }
  }

  persistenceStatements.push(
    ...tmdbCandidateOrphanCleanupStatements(env, orphanCandidates),
  );
  await env.DB.batch(persistenceStatements);
  return report;
};
