export type Movie = {
  id: string;
  title: string;
  added_at: string;
  release_date: string | null;
  poster_path: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  franchise_id: string | null;
  franchise_name?: string | null;
  franchise_position?: number | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
};

export type NowShowing = {
  id: number;
  rolled_movie_id: string | null;
  movie_id: string | null;
  franchise_id: string | null;
  status: "empty" | "pending_order" | "ready" | "watched";
  title: string | null;
  release_date: string | null;
  poster_path: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  franchise_name: string | null;
};

export type NowShowingResponse = {
  nowShowing: NowShowing | null;
  remainingFranchiseMovies: Movie[];
};
export type TmdbResult = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  imdbId: string | null;
};
export type AuthState = {
  authenticated: boolean;
  actor: { email: string; displayName: string } | null;
  local: boolean;
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Something went wrong");
  return body as T;
};

export const api = {
  authMe: () => request<AuthState>("/api/auth/me"),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  nowShowing: () => request<NowShowingResponse>("/api/now-showing"),
  movies: (status = "all") =>
    request<{ movies: Movie[] }>(`/api/movies?status=${status}`),
  franchise: (id: string) =>
    request<{ franchise: { id: string; name: string }; movies: Movie[] }>(
      `/api/franchises/${id}`,
    ),
  roll: () =>
    request<{
      rolledMovie: Movie;
      nowShowing: NowShowing;
      needsOrder: boolean;
      franchiseMovies: Movie[];
    }>("/api/roll", { method: "POST" }),
  next: () =>
    request<{ nowShowing: NowShowing }>("/api/next", { method: "POST" }),
  rate: (id: string, score: number, phrase: string) =>
    request<{ nowShowing: NowShowing }>(`/api/movies/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score, phrase }),
    }),
  order: (id: string, movieIds: string[]) =>
    request<{ nowShowing: NowShowing }>(`/api/franchises/${id}/order`, {
      method: "POST",
      body: JSON.stringify({ movieIds }),
    }),
  addMovie: (movie: {
    title: string;
    franchiseName?: string;
    releaseDate?: string | null;
    posterPath?: string | null;
    tmdbId?: number | null;
    imdbId?: string | null;
  }) =>
    request<{ movie: Movie }>("/api/movies", {
      method: "POST",
      body: JSON.stringify(movie),
    }),
  updateMovie: (
    id: string,
    movie: {
      title?: string;
      releaseDate?: string | null;
      posterPath?: string | null;
      tmdbId?: number | null;
      imdbId?: string | null;
    },
  ) =>
    request<{ movie: Movie }>(`/api/movies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(movie),
    }),
  tmdbSearch: (query: string) =>
    request<{ results: TmdbResult[] }>(
      `/api/tmdb/search?query=${encodeURIComponent(query)}`,
    ),
};
