export type Movie = {
  id: string;
  title: string;
  added_at: string;
  release_date: string | null;
  poster_path: string | null;
  tmdb_id: number | null;
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
};
export type AuthState = {
  authenticated: boolean;
  actor: { email: string; displayName: string } | null;
  local: boolean;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(body.error ?? "Something went wrong", response.status);
  }
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
    tmdbId?: number | null;
  }) =>
    request<{ movie: Movie }>("/api/movies", {
      method: "POST",
      body: JSON.stringify(movie),
    }),
  updateMovie: (
    id: string,
    movie: {
      title?: string;
      tmdbId?: number | null;
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
