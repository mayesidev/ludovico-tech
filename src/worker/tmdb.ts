import type { AppEnv } from "./env";
import {
  distinctTmdbPeople,
  parseTmdbCredits,
  parseTmdbPerson,
} from "../shared/tmdb-credits";
import {
  getTmdbMetadataContractId,
  TMDB_METADATA_RULES,
  TMDB_REQUEST_OPTIONS,
  tmdbMovieDetailSchema,
  type TmdbCollection,
  type TmdbMovieDetail,
} from "../shared/tmdb-metadata-contract";
import { recordD1Usage, type D1ProcessingUsage } from "./d1-usage";

const TMDB_API_ORIGIN = "https://api.themoviedb.org";
const TMDB_MAX_REDIRECTS = 2;
const TMDB_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type TmdbMovie = {
  id: number;
  posterPath: string | null;
  releaseDate: string | null;
  title: string;
};

export type {
  TmdbCollection,
  TmdbMovieDetail,
} from "../shared/tmdb-metadata-contract";

export type TmdbMovieResult = {
  data: TmdbMovieDetail;
  fetchedAt: string;
};

export type TmdbFailureKind =
  | "authentication"
  | "configuration"
  | "invalid_response"
  | "network"
  | "not_found"
  | "provider_rejected"
  | "provider_unavailable"
  | "rate_limited";

export class TmdbServiceError extends Error {
  readonly batchScoped: boolean;
  readonly diagnostic: string | null;
  readonly kind: TmdbFailureKind;
  readonly retryAfter: string | null;
  readonly status: 429 | 502 | 503;
  readonly upstreamStatus: number | null;

  constructor(
    kind: TmdbFailureKind,
    options: {
      diagnostic?: string | null;
      retryAfter?: string | null;
      upstreamStatus?: number | null;
    } = {},
  ) {
    super("TMDB request failed");
    this.name = "TmdbServiceError";
    this.batchScoped = kind !== "not_found";
    this.diagnostic = options.diagnostic ?? null;
    this.kind = kind;
    this.retryAfter = options.retryAfter ?? null;
    this.status =
      kind === "rate_limited" ? 429 : kind === "configuration" ? 503 : 502;
    this.upstreamStatus = options.upstreamStatus ?? null;
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

export const getTmdbMovieCacheKey = (contractId: string, movieId: number) =>
  cacheKey(`movie:${contractId}`, String(movieId));

const readCache = async <T>(env: AppEnv["Bindings"], key: string) => {
  const cached = await env.DB.prepare(
    "SELECT payload_json, fetched_at FROM tmdb_cache WHERE cache_key = ? AND expires_at > ?",
  )
    .bind(key, new Date().toISOString())
    .first<{ fetched_at: string; payload_json: string }>();
  if (!cached) return null;
  try {
    return {
      fetchedAt: cached.fetched_at,
      value: JSON.parse(cached.payload_json) as T,
    };
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
  return fetchedAt;
};

export type TmdbMovieCacheLookup = {
  cacheKey: string;
  tmdbId: number;
};

export const readTmdbMovieCacheBatch = async (
  env: AppEnv["Bindings"],
  lookups: TmdbMovieCacheLookup[],
  timestamp = new Date().toISOString(),
  usage?: D1ProcessingUsage,
) => {
  const results = new Map<number, TmdbMovieResult>();
  const invalidKeys: string[] = [];
  if (lookups.length === 0) return { invalidKeys, results };

  const lookupByKey = new Map(
    lookups.map((lookup) => [lookup.cacheKey, lookup]),
  );
  const placeholders = lookups.map(() => "?").join(", ");
  const cached = await env.DB.prepare(
    `SELECT cache_key, payload_json, fetched_at
     FROM tmdb_cache
     WHERE cache_key IN (${placeholders}) AND expires_at > ?`,
  )
    .bind(...lookups.map((lookup) => lookup.cacheKey), timestamp)
    .all<{
      cache_key: string;
      fetched_at: string;
      payload_json: string;
    }>();
  recordD1Usage(usage, cached);

  for (const row of cached.results) {
    const lookup = lookupByKey.get(row.cache_key);
    if (!lookup) continue;
    let movie: TmdbMovieDetail | null = null;
    try {
      movie = mapCachedMovieDetail(JSON.parse(row.payload_json));
    } catch {
      // The invalid row is removed with the claim's other cache maintenance.
    }
    if (!movie || movie.id !== lookup.tmdbId) {
      invalidKeys.push(row.cache_key);
      continue;
    }
    results.set(lookup.tmdbId, { data: movie, fetchedAt: row.fetched_at });
  }
  return { invalidKeys, results };
};

export const tmdbMovieCachePersistenceStatements = (
  env: AppEnv["Bindings"],
  fetched: Array<TmdbMovieCacheLookup & { result: TmdbMovieResult }>,
  invalidKeys: string[],
  timestamp = new Date().toISOString(),
) => {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM tmdb_cache WHERE expires_at <= ?").bind(
      timestamp,
    ),
  ];
  if (invalidKeys.length > 0) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM tmdb_cache
         WHERE cache_key IN (${invalidKeys.map(() => "?").join(", ")})`,
      ).bind(...invalidKeys),
    );
  }
  for (const item of fetched) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO tmdb_cache
         (cache_key, payload_json, fetched_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at
         WHERE excluded.fetched_at >= tmdb_cache.fetched_at`,
      ).bind(
        item.cacheKey,
        JSON.stringify(item.result.data),
        item.result.fetchedAt,
        new Date(
          new Date(item.result.fetchedAt).getTime() + DETAIL_TTL_MS,
        ).toISOString(),
      ),
    );
  }
  return statements;
};

const safeRetryAfter = (value: string | null) =>
  value && /^\d{1,4}$/.test(value) ? value : null;

const safeFetchDiagnostic = (error: unknown, secret: string) => {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "Unknown error";
  return detail
    .replaceAll(secret, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
};

const fetchTmdb = async (
  env: AppEnv["Bindings"],
  path: string,
  parameters: URLSearchParams,
) => {
  if (!env.TMDB_READ_ACCESS_TOKEN) {
    throw new TmdbServiceError("configuration");
  }

  let url = new URL(path, TMDB_API_ORIGIN);
  url.search = parameters.toString();
  let response: Response | null = null;
  for (
    let redirectCount = 0;
    redirectCount <= TMDB_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    try {
      response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${env.TMDB_READ_ACCESS_TOKEN}`,
        },
        redirect: "manual",
      });
    } catch (error) {
      throw new TmdbServiceError("network", {
        diagnostic: safeFetchDiagnostic(error, env.TMDB_READ_ACCESS_TOKEN),
      });
    }
    if (!TMDB_REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get("Location");
    if (!location || redirectCount === TMDB_MAX_REDIRECTS) {
      throw new TmdbServiceError("provider_rejected", {
        upstreamStatus: response.status,
      });
    }
    let redirectedUrl: URL;
    try {
      redirectedUrl = new URL(location, url);
    } catch {
      throw new TmdbServiceError("provider_rejected", {
        upstreamStatus: response.status,
      });
    }
    if (
      redirectedUrl.protocol !== "https:" ||
      redirectedUrl.origin !== TMDB_API_ORIGIN
    ) {
      throw new TmdbServiceError("provider_rejected", {
        upstreamStatus: response.status,
      });
    }
    url = redirectedUrl;
  }
  if (!response) throw new TmdbServiceError("network");

  if (response.status === 429) {
    throw new TmdbServiceError("rate_limited", {
      retryAfter: safeRetryAfter(response.headers.get("Retry-After")),
      upstreamStatus: response.status,
    });
  }
  if (!response.ok) {
    const kind: TmdbFailureKind =
      response.status === 401 || response.status === 403
        ? "authentication"
        : response.status === 404
          ? "not_found"
          : response.status >= 500
            ? "provider_unavailable"
            : "provider_rejected";
    throw new TmdbServiceError(kind, { upstreamStatus: response.status });
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TmdbServiceError("invalid_response", {
      upstreamStatus: response.status,
    });
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
    name: collection.name
      .trim()
      .slice(0, TMDB_METADATA_RULES.collection.nameMaxLength),
  };
};

const mapCachedPeople = (value: unknown, limit: number) => {
  if (!Array.isArray(value) || value.length > limit) return null;
  const people = value.map(parseTmdbPerson);
  if (people.some((person) => person === null)) return null;
  const distinct = distinctTmdbPeople(value, limit);
  return distinct.length === value.length ? distinct : null;
};

const mapCachedMovieDetail = (value: unknown): TmdbMovieDetail | null => {
  const movie = mapCachedMovie(value);
  if (!movie || !value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const cast = mapCachedPeople(
    detail.cast,
    TMDB_METADATA_RULES.people.cast.limit,
  );
  const collection = mapTmdbCollection(detail.collection);
  const directors = mapCachedPeople(
    detail.directors,
    TMDB_METADATA_RULES.people.directors.limit,
  );
  const runtimeMinutes = detail.runtimeMinutes;
  if (
    cast === null ||
    collection === undefined ||
    directors === null ||
    (runtimeMinutes !== null &&
      (!Number.isSafeInteger(runtimeMinutes) || Number(runtimeMinutes) <= 0))
  ) {
    return null;
  }
  const parsed = tmdbMovieDetailSchema.safeParse({
    ...movie,
    cast,
    collection,
    directors,
    runtimeMinutes: runtimeMinutes as number | null,
  });
  return parsed.success ? parsed.data : null;
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
    title: movie.title
      .trim()
      .slice(0, TMDB_METADATA_RULES.movie.titleMaxLength),
  };
};

const mapMovieDetail = (value: unknown): TmdbMovieDetail | null => {
  const movie = mapMovie(value);
  if (!movie || !value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const collection = mapTmdbCollection(detail.belongs_to_collection);
  const credits = parseTmdbCredits(detail.credits);
  if (!credits) return null;
  const runtime = detail.runtime;
  if (
    collection === undefined ||
    (runtime !== null &&
      runtime !== 0 &&
      (!Number.isSafeInteger(runtime) || Number(runtime) <= 0))
  ) {
    return null;
  }
  const parsed = tmdbMovieDetailSchema.safeParse({
    ...movie,
    cast: credits.cast,
    collection,
    directors: credits.directors,
    runtimeMinutes: runtime === null || runtime === 0 ? null : Number(runtime),
  });
  return parsed.success ? parsed.data : null;
};

export const searchTmdbMovies = async (
  env: AppEnv["Bindings"],
  query: string,
) => {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").slice(0, 100);
  const key = await cacheKey("search", normalizedQuery.toLowerCase());
  const cached = await readCache<unknown>(env, key);
  if (Array.isArray(cached?.value)) {
    const movies = cached.value.map(mapCachedMovie);
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
  if (!source) throw new TmdbServiceError("invalid_response");
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
): Promise<TmdbMovieResult> => {
  const contractId = await getTmdbMetadataContractId();
  const key = await getTmdbMovieCacheKey(contractId, movieId);
  const cached = await readCache<unknown>(env, key);
  const cachedMovie = mapCachedMovieDetail(cached?.value);
  if (cached && cachedMovie) {
    return { data: cachedMovie, fetchedAt: cached.fetchedAt };
  }

  const result = await fetchTmdbMovie(env, movieId);
  await env.DB.batch(
    tmdbMovieCachePersistenceStatements(
      env,
      [{ cacheKey: key, result, tmdbId: movieId }],
      [],
    ),
  );
  return result;
};

export const fetchTmdbMovie = async (
  env: AppEnv["Bindings"],
  movieId: number,
): Promise<TmdbMovieResult> => {
  const value = await fetchTmdb(
    env,
    `/3/movie/${movieId}`,
    new URLSearchParams({
      append_to_response: TMDB_REQUEST_OPTIONS.appendToResponse.join(","),
      language: TMDB_REQUEST_OPTIONS.language,
    }),
  );
  const movie = mapMovieDetail(value);
  if (!movie || movie.id !== movieId) {
    throw new TmdbServiceError("invalid_response");
  }
  return { data: movie, fetchedAt: new Date().toISOString() };
};
