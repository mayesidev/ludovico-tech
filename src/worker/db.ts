import type { AppEnv } from "./env";

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
  rolled_movie_id: string | null;
  movie_id: string | null;
  collection_id: string | null;
  status: "empty" | "ready" | "watched";
  rolled_at: string | null;
  updated_at: string;
  title: string | null;
  version: string | null;
  release_date: string | null;
  poster_path: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  movie_collection_id: string | null;
  collection_name: string | null;
};

export type TmdbPersonReference = {
  tmdbId: number;
  name: string;
};

export type MovieCredits = {
  cast: TmdbPersonReference[];
  directors: TmdbPersonReference[];
};

export const movieSelect = `
  SELECT movies.id, movies.title, movies.added_at,
    COALESCE(movie_tmdb_data.release_date, movies.release_date) AS release_date,
    COALESCE(movie_tmdb_data.poster_path, movies.poster_path) AS poster_path,
    COALESCE(movie_tmdb_data.runtime_minutes, movies.runtime_minutes) AS runtime_minutes,
    movies.version,
    movies.version_runtime, movies.version_reference_url, movies.imdb_id,
    COALESCE(movie_tmdb_data.tmdb_id, movies.tmdb_id) AS tmdb_id,
    COALESCE(movie_tmdb_data.tmdb_collection_id, movies.tmdb_collection_id) AS tmdb_collection_id,
    COALESCE(tmdb_collections.name, movies.tmdb_collection_name) AS tmdb_collection_name,
    collections.name AS collection_name,
    collections.order_confirmed AS collection_order_confirmed,
    collection_movies.collection_id, collection_movies.position AS collection_position,
    ratings.score AS rating_score, ratings.phrase AS rating_phrase,
    ratings.watched_at
  FROM movies
  LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
  LEFT JOIN tmdb_collections ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
  LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
  LEFT JOIN collections ON collections.id = collection_movies.collection_id
  LEFT JOIN ratings ON ratings.movie_id = movies.id
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

export const getMovieDetail = async (env: AppEnv["Bindings"], id: string) => {
  const movie = await getMovie(env, id);
  if (!movie) return null;
  return { ...movie, ...(await getMovieCredits(env, id)) };
};

export const getNowShowing = async (env: AppEnv["Bindings"]) =>
  env.DB.prepare(
    `SELECT now_showing.*, movies.title, movies.version,
        COALESCE(movie_tmdb_data.release_date, movies.release_date) AS release_date,
        COALESCE(movie_tmdb_data.poster_path, movies.poster_path) AS poster_path,
        ratings.score AS rating_score, ratings.phrase AS rating_phrase,
        ratings.watched_at, collection_movies.collection_id AS movie_collection_id,
        collections.name AS collection_name
       FROM now_showing
       LEFT JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
       LEFT JOIN collections ON collections.id = now_showing.collection_id
       WHERE now_showing.id = 1`,
  ).first<NowShowingRow>();

export const getNowShowingDetail = async (env: AppEnv["Bindings"]) => {
  const current = await getNowShowing(env);
  if (!current) return null;
  return {
    ...current,
    ...(current.movie_id
      ? await getMovieCredits(env, current.movie_id)
      : { cast: [], directors: [] }),
  };
};

export const getRemainingCollectionMovies = async (
  env: AppEnv["Bindings"],
  collectionId: string,
) => {
  const result = await env.DB.prepare(
    `${movieSelect}
       WHERE collection_movies.collection_id = ? AND ratings.id IS NULL
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
