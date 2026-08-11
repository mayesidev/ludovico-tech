import type { AppEnv } from "./env";

const TMDB_API_ORIGIN = "https://api.themoviedb.org";
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TmdbMovie = {
  id: number;
  posterPath: string | null;
  releaseDate: string | null;
  title: string;
};

export type TmdbCollection = {
  id: number;
  name: string;
};

export type TmdbMovieDetail = TmdbMovie & {
  collection: TmdbCollection | null;
  runtimeMinutes: number | null;
};

export class TmdbServiceError extends Error {
  readonly retryAfter: string | null;
  readonly status: 429 | 502 | 503;

  constructor(status: 429 | 502 | 503, retryAfter: string | null = null) {
    super("TMDB request failed");
    this.name = "TmdbServiceError";
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

const cacheKey = async (scope: string, value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `tmdb:${scope}:${hash}`;
};

const readCache = async <T>(env: AppEnv["Bindings"], key: string) => {
  const cached = await env.DB.prepare(
    "SELECT payload_json FROM tmdb_cache WHERE cache_key = ? AND expires_at > ?",
  )
    .bind(key, new Date().toISOString())
    .first<{ payload_json: string }>();
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload_json) as T;
  } catch {
    await env.DB.prepare("DELETE FROM tmdb_cache WHERE cache_key = ?")
      .bind(key)
      .run();
    return null;
  }
};

const writeCache = async (
  env: AppEnv["Bindings"],
  key: string,
  value: unknown,
  ttlMs: number,
) => {
  const fetchedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tmdb_cache WHERE expires_at <= ?").bind(
      fetchedAt,
    ),
    env.DB.prepare(
      `INSERT INTO tmdb_cache (cache_key, payload_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`,
    ).bind(key, JSON.stringify(value), fetchedAt, expiresAt),
  ]);
};

const safeRetryAfter = (value: string | null) =>
  value && /^\d{1,4}$/.test(value) ? value : null;

const fetchTmdb = async (
  env: AppEnv["Bindings"],
  path: string,
  parameters: URLSearchParams,
) => {
  if (!env.TMDB_READ_ACCESS_TOKEN) throw new TmdbServiceError(503);

  let response: Response;
  try {
    const url = new URL(path, TMDB_API_ORIGIN);
    url.search = parameters.toString();
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.TMDB_READ_ACCESS_TOKEN}`,
      },
    });
  } catch {
    throw new TmdbServiceError(502);
  }

  if (response.status === 429) {
    throw new TmdbServiceError(
      429,
      safeRetryAfter(response.headers.get("Retry-After")),
    );
  }
  if (!response.ok) throw new TmdbServiceError(502);

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TmdbServiceError(502);
  }
};

const nullableProviderString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

const mapCachedMovie = (value: unknown): TmdbMovie | null => {
  if (!value || typeof value !== "object") return null;
  const movie = value as Record<string, unknown>;
  if (
    !Number.isInteger(movie.id) ||
    Number(movie.id) <= 0 ||
    typeof movie.title !== "string" ||
    !movie.title ||
    (movie.posterPath !== null && typeof movie.posterPath !== "string") ||
    (movie.releaseDate !== null && typeof movie.releaseDate !== "string")
  ) {
    return null;
  }
  return movie as unknown as TmdbMovie;
};

const mapTmdbCollection = (
  value: unknown,
): TmdbCollection | null | undefined => {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const collection = value as Record<string, unknown>;
  if (
    !Number.isInteger(collection.id) ||
    Number(collection.id) <= 0 ||
    typeof collection.name !== "string" ||
    !collection.name.trim()
  ) {
    return undefined;
  }
  return {
    id: Number(collection.id),
    name: collection.name.trim().slice(0, 200),
  };
};

const mapCachedMovieDetail = (value: unknown): TmdbMovieDetail | null => {
  const movie = mapCachedMovie(value);
  if (!movie || !value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const collection = mapTmdbCollection(detail.collection);
  const runtimeMinutes = detail.runtimeMinutes;
  if (
    collection === undefined ||
    (runtimeMinutes !== null &&
      (!Number.isSafeInteger(runtimeMinutes) || Number(runtimeMinutes) <= 0))
  ) {
    return null;
  }
  return {
    ...movie,
    collection,
    runtimeMinutes: runtimeMinutes as number | null,
  };
};

const mapMovie = (value: unknown): TmdbMovie | null => {
  if (!value || typeof value !== "object") return null;
  const movie = value as Record<string, unknown>;
  if (
    !Number.isInteger(movie.id) ||
    Number(movie.id) <= 0 ||
    typeof movie.title !== "string" ||
    !movie.title.trim()
  ) {
    return null;
  }
  return {
    id: Number(movie.id),
    posterPath: /^\/[A-Za-z0-9._-]{1,200}$/.test(
      nullableProviderString(movie.poster_path) ?? "",
    )
      ? String(movie.poster_path)
      : null,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(
      nullableProviderString(movie.release_date) ?? "",
    )
      ? String(movie.release_date)
      : null,
    title: movie.title.trim().slice(0, 200),
  };
};

const mapMovieDetail = (value: unknown): TmdbMovieDetail | null => {
  const movie = mapMovie(value);
  if (!movie || !value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const collection = mapTmdbCollection(detail.belongs_to_collection);
  const runtime = detail.runtime;
  if (
    collection === undefined ||
    (runtime !== null &&
      runtime !== 0 &&
      (!Number.isSafeInteger(runtime) || Number(runtime) <= 0))
  ) {
    return null;
  }
  return {
    ...movie,
    collection,
    runtimeMinutes: runtime === null || runtime === 0 ? null : Number(runtime),
  };
};

export const searchTmdbMovies = async (
  env: AppEnv["Bindings"],
  query: string,
) => {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").slice(0, 100);
  const key = await cacheKey("search", normalizedQuery.toLowerCase());
  const cached = await readCache<unknown>(env, key);
  if (Array.isArray(cached)) {
    const movies = cached.map(mapCachedMovie);
    if (movies.every((movie): movie is TmdbMovie => Boolean(movie))) {
      return movies;
    }
  }

  const value = await fetchTmdb(
    env,
    "/3/search/movie",
    new URLSearchParams({
      include_adult: "false",
      language: "en-US",
      query: normalizedQuery,
    }),
  );
  const response =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const source =
    response && Array.isArray(response.results) ? response.results : null;
  if (!source) throw new TmdbServiceError(502);
  const results = source
    .map((movie: unknown) => mapMovie(movie))
    .filter((movie): movie is TmdbMovie => Boolean(movie))
    .slice(0, 8);
  await writeCache(env, key, results, SEARCH_TTL_MS);
  return results;
};

export const getTmdbMovie = async (
  env: AppEnv["Bindings"],
  movieId: number,
) => {
  const key = await cacheKey("movie", String(movieId));
  const cached = mapCachedMovieDetail(await readCache<unknown>(env, key));
  if (cached) return cached;

  const value = await fetchTmdb(
    env,
    `/3/movie/${movieId}`,
    new URLSearchParams({ language: "en-US" }),
  );
  const movie = mapMovieDetail(value);
  if (!movie || movie.id !== movieId) throw new TmdbServiceError(502);
  await writeCache(env, key, movie, DETAIL_TTL_MS);
  return movie;
};
