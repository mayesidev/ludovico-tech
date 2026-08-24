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
  imdb_id: string | null;
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

export type TmdbPersonReference = {
  tmdbId: number;
  name: string;
};

export type MovieDetail = Movie & {
  cast: TmdbPersonReference[];
  directors: TmdbPersonReference[];
};

export type NowShowing = {
  added_at?: string | null;
  cast: TmdbPersonReference[];
  id: number;
  rolled_movie_id: string | null;
  movie_id: string | null;
  collection_id: string | null;
  status: "empty" | "ready" | "watched";
  title: string | null;
  version: string | null;
  version_runtime?: number | null;
  release_date: string | null;
  poster_path: string | null;
  runtime_minutes?: number | null;
  rating_score: number | null;
  rating_phrase: string | null;
  watched_at: string | null;
  collection_name: string | null;
  directors: TmdbPersonReference[];
};

export type HomeMovie = Pick<
  Movie,
  | "id"
  | "title"
  | "poster_path"
  | "version"
  | "rating_score"
  | "rating_phrase"
  | "watched_at"
>;

export type HomeResponse = {
  hasNextCollectionMovie: boolean;
  nowShowing: NowShowing | null;
  posterReelMovies: HomeMovie[];
  watchedMovies: HomeMovie[];
};

export type LibraryQuery = {
  direction: "asc" | "desc";
  page: number;
  pageSize: 25 | 50 | 100;
  search: string;
  sort: "title" | "collection" | "releaseDate" | "addedAt" | "rating";
  status: "all" | "watched" | "unwatched";
};

export type LibraryResponse = {
  counts: { total: number; unwatched: number };
  movies: Movie[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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

export type TmdbRefreshStatus = {
  currentDataVersion: number;
  counts: {
    current: number;
    failed: number;
    linked: number;
    pending: number;
    total: number;
    unlinked: number;
  };
  items: Array<{
    dataVersion: number | null;
    fetchedAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    lastResult: "failed" | "running" | "succeeded" | null;
    movieId: string;
    refreshAfter: string | null;
    state:
      | "current"
      | "due"
      | "failed"
      | "never_fetched"
      | "unlinked"
      | "version_stale";
    title: string;
    tmdbId: number | null;
  }>;
  schedule: {
    batchSize: number;
    enabled: boolean;
    intervalMinutes: number;
    lastAttempted: number;
    lastCompletedAt: string | null;
    lastError: string | null;
    lastFailed: number;
    lastRateLimited: boolean;
    lastRefreshed: number;
    lastRemaining: number;
    lastStartedAt: string | null;
    leaseExpiresAt: string | null;
    nextRunAt: string;
    running: boolean;
  };
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
  home: () => request<HomeResponse>("/api/home"),
  movies: (status = "all") =>
    request<{ movies: Movie[] }>(`/api/movies?status=${status}`),
  library: (query: LibraryQuery) => {
    const parameters = new URLSearchParams({
      direction: query.direction,
      page: String(query.page),
      pageSize: String(query.pageSize),
      search: query.search,
      sort: query.sort,
      status: query.status,
    });
    return request<LibraryResponse>(`/api/library?${parameters.toString()}`);
  },
  movie: (id: string) =>
    request<{ movie: MovieDetail }>(`/api/movies/${encodeURIComponent(id)}`),
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
    imdbId?: string | null;
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
      imdbId?: string | null;
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
  tmdbRefreshStatus: () => request<TmdbRefreshStatus>("/api/tmdb-refresh"),
  updateTmdbRefreshSchedule: (schedule: {
    batchSize?: number;
    enabled?: boolean;
    intervalMinutes?: number;
  }) =>
    request<{ updated: true }>("/api/tmdb-refresh/schedule", {
      method: "PATCH",
      body: JSON.stringify(schedule),
    }),
  runTmdbRefresh: () =>
    request<{ started: true }>("/api/tmdb-refresh/run", { method: "POST" }),
};
