import type { AppEnv } from "./env";

export type MovieRow = {
  id: string;
  title: string;
  title_normalized: string;
  added_at: string;
  added_by: string | null;
  source_added_at: string | null;
  source_row: number | null;
  updated_at: string;
  updated_by: string | null;
  release_date: string | null;
  poster_path: string | null;
  tmdb_id: number | null;
  tmdb_fetched_at: string | null;
  imdb_id: string | null;
  franchise_id: string | null;
  prior_viewed: number;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  franchise_name?: string | null;
  franchise_position?: number | null;
};

export type FranchiseRow = {
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
  franchise_id: string | null;
  status: "empty" | "pending_order" | "ready" | "watched";
  rolled_at: string | null;
  updated_at: string;
  title: string | null;
  release_date: string | null;
  poster_path: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  movie_franchise_id: string | null;
  franchise_name: string | null;
};

export const movieSelect = `
  SELECT movies.*, franchises.name AS franchise_name,
    franchise_movies.position AS franchise_position
  FROM movies
  LEFT JOIN franchises ON franchises.id = movies.franchise_id
  LEFT JOIN franchise_movies ON franchise_movies.movie_id = movies.id
`;

export const getMovie = async (env: AppEnv["Bindings"], id: string) =>
  env.DB.prepare(`${movieSelect} WHERE movies.id = ?`)
    .bind(id)
    .first<MovieRow>();

export const getNowShowing = async (env: AppEnv["Bindings"]) =>
  env.DB.prepare(
    `SELECT now_showing.*, movies.title, movies.release_date, movies.poster_path,
        movies.rating_score, movies.rating_phrase, movies.watched_at,
        movies.franchise_id AS movie_franchise_id, franchises.name AS franchise_name
       FROM now_showing
       LEFT JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN franchises ON franchises.id = now_showing.franchise_id
       WHERE now_showing.id = 1`,
  ).first<NowShowingRow>();

export const getRemainingFranchiseMovies = async (
  env: AppEnv["Bindings"],
  franchiseId: string,
) => {
  const result = await env.DB.prepare(
    `${movieSelect}
       WHERE movies.franchise_id = ? AND movies.rating_score IS NULL
       ORDER BY franchise_movies.position ASC, movies.added_at ASC`,
  )
    .bind(franchiseId)
    .all<MovieRow>();
  return result.results;
};

export const getFranchiseMovies = async (
  env: AppEnv["Bindings"],
  franchiseId: string,
) => {
  const result = await env.DB.prepare(
    `${movieSelect} WHERE movies.franchise_id = ? ORDER BY franchise_movies.position ASC, movies.added_at ASC`,
  )
    .bind(franchiseId)
    .all<MovieRow>();
  return result.results;
};
