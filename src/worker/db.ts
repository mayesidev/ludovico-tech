import type { AppEnv } from "./env";
import { attributionDisplayName } from "./attribution";
import { createRandomIndexSampler } from "./random-sample";

export type MovieRow = {
  id: string;
  title: string;
  added_at: string;
  release_date: string | null;
  poster_path: string | null;
  runtime_minutes: number | null;
  version: string | null;
  version_runtime: number | null;
  version_reference_url: string | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  tmdb_collection_id: number | null;
  tmdb_collection_name: string | null;
  collection_id: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  collection_name?: string | null;
  collection_position?: number | null;
  collection_order_confirmed?: number | null;
};

export type CollectionRow = {
  id: string;
  name: string;
  order_confirmed: number;
  created_at: string;
  updated_at: string;
};

export type NowShowingRow = {
  id: number;
  movie_id: string | null;
  collection_id: string | null;
  title: string | null;
  added_at: string | null;
  version: string | null;
  version_runtime: number | null;
  release_date: string | null;
  poster_path: string | null;
  runtime_minutes: number | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  collection_name: string | null;
};

type AttributionRow = {
  attribution_key: string | null;
  occurred_at: string | null;
  user_display_name: string | null;
  user_email: string | null;
};

const mapAttribution = (row: AttributionRow) => ({
  at: row.occurred_at,
  by: attributionDisplayName(
    row.attribution_key,
    row.user_display_name,
    row.user_email,
  ),
});

export type HomeMovieRow = {
  id: string;
  title: string;
  poster_path: string | null;
  version: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
};

export type RandomMovieRow = {
  collection_id: string | null;
  id: string;
  title: string;
};

export type TmdbPersonReference = {
  tmdbId: number;
  name: string;
};

export type MovieCredits = {
  cast: TmdbPersonReference[];
  directors: TmdbPersonReference[];
};

export const movieFrom = `
  FROM movies
  LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
  LEFT JOIN tmdb_collections ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
  LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
  LEFT JOIN collections ON collections.id = collection_movies.collection_id
  LEFT JOIN ratings ON ratings.movie_id = movies.id
`;

export const movieSelect = `
  SELECT movies.id, movies.title, movies.added_at,
    movie_tmdb_data.release_date,
    movie_tmdb_data.poster_path,
    movie_tmdb_data.runtime_minutes,
    movies.version,
    movies.version_runtime, movies.version_reference_url, movies.imdb_id,
    movie_tmdb_data.tmdb_id,
    movie_tmdb_data.tmdb_collection_id,
    tmdb_collections.name AS tmdb_collection_name,
    collections.name AS collection_name,
    collections.order_confirmed AS collection_order_confirmed,
    collection_movies.collection_id, collection_movies.position AS collection_position,
    ratings.score AS rating_score, ratings.phrase AS rating_phrase,
    ratings.watched_at
  ${movieFrom}
`;

export const getMovie = async (env: AppEnv["Bindings"], id: string) =>
  env.DB.prepare(`${movieSelect} WHERE movies.id = ?`)
    .bind(id)
    .first<MovieRow>();

export const getMovieCredits = async (
  env: AppEnv["Bindings"],
  movieId: string,
): Promise<MovieCredits> => {
  const result = await env.DB.prepare(
    `SELECT movie_credits.credit_type, tmdb_people.tmdb_id, tmdb_people.name
     FROM movie_credits
     JOIN tmdb_people ON tmdb_people.tmdb_id = movie_credits.tmdb_person_id
     WHERE movie_credits.movie_id = ?
     ORDER BY movie_credits.credit_type, movie_credits.position`,
  )
    .bind(movieId)
    .all<{ credit_type: "cast" | "director"; tmdb_id: number; name: string }>();
  const credits: MovieCredits = { cast: [], directors: [] };
  for (const row of result.results) {
    credits[row.credit_type === "cast" ? "cast" : "directors"].push({
      tmdbId: row.tmdb_id,
      name: row.name,
    });
  }
  return credits;
};

const getMovieAudit = async (env: AppEnv["Bindings"], id: string) => {
  const row = await env.DB.prepare(
    `SELECT
       movies.added_at,
       movies.added_by,
       adding_user.display_name AS added_by_display_name,
       adding_user.email AS added_by_email,
       movies.updated_at,
       movies.updated_by,
       updating_user.display_name AS updated_by_display_name,
       updating_user.email AS updated_by_email,
       ratings.recorded_at,
       ratings.recorded_by,
       rating_user.display_name AS recorded_by_display_name,
       rating_user.email AS recorded_by_email,
       movie_tmdb_data.updated_at AS metadata_updated_at,
       movie_tmdb_data.updated_by AS metadata_updated_by,
       metadata_user.display_name AS metadata_updated_by_display_name,
       metadata_user.email AS metadata_updated_by_email
     FROM movies
     LEFT JOIN ratings ON ratings.movie_id = movies.id
     LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
     LEFT JOIN users AS adding_user ON adding_user.id = movies.added_by
     LEFT JOIN users AS updating_user ON updating_user.id = movies.updated_by
     LEFT JOIN users AS rating_user ON rating_user.id = ratings.recorded_by
     LEFT JOIN users AS metadata_user ON metadata_user.id = movie_tmdb_data.updated_by
     WHERE movies.id = ?`,
  )
    .bind(id)
    .first<{
      added_at: string;
      added_by: string | null;
      added_by_display_name: string | null;
      added_by_email: string | null;
      metadata_updated_at: string | null;
      metadata_updated_by: string | null;
      metadata_updated_by_display_name: string | null;
      metadata_updated_by_email: string | null;
      recorded_at: string | null;
      recorded_by: string | null;
      recorded_by_display_name: string | null;
      recorded_by_email: string | null;
      updated_at: string | null;
      updated_by: string | null;
      updated_by_display_name: string | null;
      updated_by_email: string | null;
    }>();
  if (!row) return null;
  return {
    added: mapAttribution({
      attribution_key: row.added_by,
      occurred_at: row.added_at,
      user_display_name: row.added_by_display_name,
      user_email: row.added_by_email,
    }),
    metadata: mapAttribution({
      attribution_key: row.metadata_updated_by,
      occurred_at: row.metadata_updated_at,
      user_display_name: row.metadata_updated_by_display_name,
      user_email: row.metadata_updated_by_email,
    }),
    rating: mapAttribution({
      attribution_key: row.recorded_by,
      occurred_at: row.recorded_at,
      user_display_name: row.recorded_by_display_name,
      user_email: row.recorded_by_email,
    }),
    updated: mapAttribution({
      attribution_key: row.updated_by,
      occurred_at: row.updated_at,
      user_display_name: row.updated_by_display_name,
      user_email: row.updated_by_email,
    }),
  };
};

export const getMovieDetail = async (
  env: AppEnv["Bindings"],
  id: string,
  includeAudit = false,
) => {
  const movie = await getMovie(env, id);
  if (!movie) return null;
  return {
    ...movie,
    ...(await getMovieCredits(env, id)),
    ...(includeAudit ? { audit: await getMovieAudit(env, id) } : {}),
  };
};

export const getNowShowing = async (env: AppEnv["Bindings"]) =>
  env.DB.prepare(
    `SELECT now_showing.id, now_showing.movie_id,
        movies.title, movies.added_at, movies.version,
        movies.version_runtime,
        movie_tmdb_data.release_date,
        movie_tmdb_data.poster_path,
        movie_tmdb_data.runtime_minutes,
        ratings.score AS rating_score, ratings.phrase AS rating_phrase,
        ratings.watched_at, collection_movies.collection_id,
        collections.name AS collection_name
       FROM now_showing
       LEFT JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
       LEFT JOIN collections ON collections.id = collection_movies.collection_id
       WHERE now_showing.id = 1`,
  ).first<NowShowingRow>();

const getNowShowingAudit = async (env: AppEnv["Bindings"]) => {
  const row = await env.DB.prepare(
    `SELECT now_showing.rolled_at AS occurred_at,
       now_showing.rolled_by AS attribution_key,
       users.display_name AS user_display_name,
       users.email AS user_email
     FROM now_showing
     LEFT JOIN users ON users.id = now_showing.rolled_by
     WHERE now_showing.id = 1`,
  ).first<AttributionRow>();
  return row ? mapAttribution(row) : { at: null, by: null };
};

export const getNowShowingDetail = async (
  env: AppEnv["Bindings"],
  includeAudit = false,
  selection?: NowShowingRow | null,
) => {
  const current =
    selection === undefined ? await getNowShowing(env) : selection;
  if (!current) return null;
  const [credits, selectionAudit, movieAudit] = await Promise.all([
    current.movie_id
      ? getMovieCredits(env, current.movie_id)
      : { cast: [], directors: [] },
    includeAudit ? getNowShowingAudit(env) : null,
    includeAudit && current.movie_id
      ? getMovieAudit(env, current.movie_id)
      : null,
  ]);
  return {
    ...current,
    ...credits,
    status:
      current.movie_id === null
        ? ("empty" as const)
        : current.rating_score === null
          ? ("ready" as const)
          : ("watched" as const),
    ...(includeAudit
      ? { audit: { movie: movieAudit, rolled: selectionAudit! } }
      : {}),
  };
};

export const getRemainingCollectionMovies = async (
  env: AppEnv["Bindings"],
  collectionId: string,
) => {
  const result = await env.DB.prepare(
    `${movieSelect}
       WHERE collection_movies.collection_id = ? AND ratings.movie_id IS NULL
       ORDER BY
         CASE WHEN collections.order_confirmed = 1 THEN collection_movies.position END ASC,
         CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
         movies.added_at ASC,
         movies.id ASC`,
  )
    .bind(collectionId)
    .all<MovieRow>();
  return result.results;
};

const homeMovieSelect = `
  SELECT movies.id, movies.title, movies.version,
    movie_tmdb_data.poster_path,
    ratings.score AS rating_score, ratings.phrase AS rating_phrase,
    ratings.watched_at
  FROM movies
  LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
  LEFT JOIN ratings ON ratings.movie_id = movies.id
`;

const getRandomRollCandidateRows = async <Row>(
  env: AppEnv["Bindings"],
  select: string,
  limit: number,
  randomIndex?: (upperBound: number) => number,
) => {
  const row = await env.DB.prepare(
    "SELECT MAX(slot) AS max_slot FROM roll_candidates",
  ).first<{ max_slot: number | null }>();
  const sampleIndex = createRandomIndexSampler(row?.max_slot ?? 0, randomIndex);
  const selected: Row[] = [];

  while (selected.length < limit) {
    const slots: number[] = [];
    while (slots.length < limit - selected.length) {
      const index = sampleIndex();
      if (index === null) break;
      slots.push(index + 1);
    }
    if (slots.length === 0) break;
    const sampled = await env.DB.batch<Row>(
      slots.map((slot) =>
        env.DB.prepare(`${select} WHERE roll_candidates.slot = ?`).bind(slot),
      ),
    );
    selected.push(...sampled.flatMap(({ results }) => results));
  }
  return selected;
};

export const getWatchedHistory = async (
  env: AppEnv["Bindings"],
  randomIndex?: (upperBound: number) => number,
) => {
  const latest = await env.DB.prepare(
    `${homeMovieSelect}
     WHERE ratings.movie_id IS NOT NULL AND ratings.watched_at IS NOT NULL
     ORDER BY ratings.watched_at DESC, ratings.movie_id ASC
     LIMIT 1`,
  ).first<HomeMovieRow>();
  const bounds = await env.DB.prepare(
    `SELECT MAX(rowid) AS max_row_id,
       (SELECT rowid FROM ratings WHERE movie_id = ?) AS excluded_row_id
     FROM ratings`,
  )
    .bind(latest?.id ?? null)
    .first<{ excluded_row_id: number | null; max_row_id: number | null }>();
  const excludedRowId = bounds?.excluded_row_id ?? null;
  const populationSize = Math.max(
    0,
    (bounds?.max_row_id ?? 0) - (excludedRowId === null ? 0 : 1),
  );
  const limit = latest ? 3 : 4;
  const sampleIndex = createRandomIndexSampler(populationSize, randomIndex);
  const previous: HomeMovieRow[] = [];

  while (previous.length < limit) {
    const rowIds: number[] = [];
    while (rowIds.length < limit - previous.length) {
      const index = sampleIndex();
      if (index === null) break;
      const rowId = index + 1;
      rowIds.push(
        excludedRowId !== null && rowId >= excludedRowId ? rowId + 1 : rowId,
      );
    }
    if (rowIds.length === 0) break;
    const sampled = await env.DB.batch<HomeMovieRow>(
      rowIds.map((rowId) =>
        env.DB.prepare(`${homeMovieSelect} WHERE ratings.rowid = ?`).bind(
          rowId,
        ),
      ),
    );
    previous.push(...sampled.flatMap(({ results }) => results));
  }
  return latest ? [latest, ...previous] : previous;
};

export const getRandomUnwatchedMovie = async (
  env: AppEnv["Bindings"],
  randomIndex?: (upperBound: number) => number,
) => {
  const select = `SELECT movies.id, movies.title,
      collection_movies.collection_id
    FROM roll_candidates
    JOIN movies ON movies.id = roll_candidates.movie_id
    LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
  `;
  const [movie] = await getRandomRollCandidateRows<RandomMovieRow>(
    env,
    select,
    1,
    randomIndex,
  );
  return movie ?? null;
};

export const getPosterReelMovies = async (
  env: AppEnv["Bindings"],
  randomIndex?: (upperBound: number) => number,
) => {
  const select = `
    SELECT movies.id, movies.title, movies.version,
      movie_tmdb_data.poster_path,
      NULL AS rating_score, NULL AS rating_phrase, NULL AS watched_at
    FROM roll_candidates
    JOIN movies ON movies.id = roll_candidates.movie_id
    LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
  `;
  return getRandomRollCandidateRows<HomeMovieRow>(env, select, 12, randomIndex);
};

export const hasRemainingCollectionMovie = async (
  env: AppEnv["Bindings"],
  collectionId: string,
) =>
  Boolean(
    await env.DB.prepare(
      `SELECT 1
       FROM collection_movies
       LEFT JOIN ratings ON ratings.movie_id = collection_movies.movie_id
       WHERE collection_movies.collection_id = ? AND ratings.movie_id IS NULL
       LIMIT 1`,
    )
      .bind(collectionId)
      .first(),
  );

export const getCollectionMovies = async (
  env: AppEnv["Bindings"],
  collectionId: string,
) => {
  const result = await env.DB.prepare(
    `${movieSelect}
     WHERE collection_movies.collection_id = ?
     ORDER BY
       CASE WHEN collections.order_confirmed = 1 THEN collection_movies.position END ASC,
       CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
       movies.added_at ASC,
       movies.id ASC`,
  )
    .bind(collectionId)
    .all<MovieRow>();
  return result.results;
};
