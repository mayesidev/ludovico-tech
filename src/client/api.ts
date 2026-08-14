export type Movie = {
  id: string;
  title: string;
  added_at: string;
  release_date: string | null;
  poster_path: string | null;
  runtime_minutes: number | null;
  version: string | null;
  version_runtime: number | null;
  version_reference_url: string | null;
  tmdb_id: number | null;
  tmdb_collection_id?: number | null;
  tmdb_collection_name?: string | null;
  collection_id: string | null;
  collection_name?: string | null;
  collection_position?: number | null;
  collection_order_confirmed?: number | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
};

export type NowShowing = {
  id: number;
  rolled_movie_id: string | null;
  movie_id: string | null;
  collection_id: string | null;
  status: "empty" | "ready" | "watched";
  title: string | null;
  version: string | null;
  release_date: string | null;
  poster_path: string | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  collection_name: string | null;
};

export type NowShowingResponse = {
  nowShowing: NowShowing | null;
  remainingCollectionMovies: Movie[];
};
export type TmdbResult = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
};
export type TmdbMovieDetail = TmdbResult & {
  collection: TmdbCollectionReference | null;
  runtimeMinutes: number | null;
};
export type TmdbCollectionReference = {
  id: number;
  name: string;
};
export type AuthState = {
  authenticated: boolean;
  actor: { email: string; displayName: string } | null;
  local: boolean;
};
export type HealthState = {
  ok: boolean;
  environment: string;
  version: string;
  commit: string;
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
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    message?: unknown;
  };
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : body.error !== undefined || body.message !== undefined
            ? "Request validation failed"
            : "Something went wrong";
    throw new ApiError(message, response.status);
  }
  return body as T;
};

export const api = {
  health: () => request<HealthState>("/api/health"),
  authMe: () => request<AuthState>("/api/auth/me"),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  nowShowing: () => request<NowShowingResponse>("/api/now-showing"),
  movies: (status = "all") =>
    request<{ movies: Movie[] }>(`/api/movies?status=${status}`),
  collection: (id: string) =>
    request<{
      collection: { id: string; name: string };
      movies: Movie[];
      tmdbCollections: TmdbCollectionReference[];
    }>(`/api/collections/${id}`),
  roll: () =>
    request<{
      rolledMovie: Movie;
      nowShowing: NowShowing;
    }>("/api/roll", { method: "POST" }),
  next: () =>
    request<{ nowShowing: NowShowing }>("/api/next", { method: "POST" }),
  rate: (id: string, score: number, phrase: string) =>
    request<{ nowShowing: NowShowing }>(`/api/movies/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score, phrase }),
    }),
  order: (id: string, movieIds: string[]) =>
    request<{ nowShowing: NowShowing }>(`/api/collections/${id}/order`, {
      method: "POST",
      body: JSON.stringify({ movieIds }),
    }),
  addMovie: (movie: {
    title: string;
    collectionName?: string;
    tmdbId?: number | null;
    version?: string | null;
    versionRuntime?: number | null;
    versionReferenceUrl?: string | null;
  }) =>
    request<{ movie: Movie }>("/api/movies", {
      method: "POST",
      body: JSON.stringify(movie),
    }),
  updateMovie: (
    id: string,
    movie: {
      collectionName?: string | null;
      title?: string;
      tmdbId?: number | null;
      version?: string | null;
      versionRuntime?: number | null;
      versionReferenceUrl?: string | null;
    },
  ) =>
    request<{ movie: Movie }>(`/api/movies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(movie),
    }),
  deleteMovie: (id: string) =>
    request<{ deleted: true; id: string }>(`/api/movies/${id}`, {
      method: "DELETE",
    }),
  tmdbSearch: (query: string) =>
    request<{ results: TmdbResult[] }>(
      `/api/tmdb/search?query=${encodeURIComponent(query)}`,
    ),
  tmdbMovie: (id: number) =>
    request<{ movie: TmdbMovieDetail }>(`/api/tmdb/movies/${id}`),
};
