import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseIntermediateJson } from "./import-sheet-lib";
import {
  parseTmdbFindResponse,
  parseTmdbMovieResponse,
  reconcileTmdb,
  type TmdbFindMovie,
  type TmdbMovieDetail,
} from "./reconcile-tmdb-lib";

type ReconciliationCache = {
  findEntries: Record<string, TmdbFindMovie[]>;
  movieEntries: Record<string, TmdbMovieDetail>;
  schemaVersion: 4;
};

const [inputArgument, outputArgument, reportArgument, cacheArgument] =
  process.argv.slice(2).filter((argument) => argument !== "--");

const fail = (message: string) => {
  console.error(message);
  process.exitCode = 1;
};

const validCachedMovie = (value: unknown): value is TmdbFindMovie => {
  if (!value || typeof value !== "object") return false;
  const movie = value as Record<string, unknown>;
  return (
    Number.isInteger(movie.id) &&
    Number(movie.id) > 0 &&
    typeof movie.title === "string" &&
    Boolean(movie.title) &&
    (movie.posterPath === null ||
      (typeof movie.posterPath === "string" &&
        /^\/[A-Za-z0-9._-]{1,200}$/.test(movie.posterPath))) &&
    (movie.releaseDate === null ||
      (typeof movie.releaseDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(movie.releaseDate)))
  );
};

const validCachedMovieDetail = (value: unknown): value is TmdbMovieDetail => {
  if (!value || typeof value !== "object") return false;
  const movie = value as Record<string, unknown>;
  const collection = movie.collection;
  const peopleAreValid = (people: unknown, limit: number) =>
    Array.isArray(people) &&
    people.length <= limit &&
    new Set(
      people.map((person) =>
        person && typeof person === "object"
          ? (person as Record<string, unknown>).id
          : null,
      ),
    ).size === people.length &&
    people.every(
      (person) =>
        person !== null &&
        typeof person === "object" &&
        Number.isInteger((person as Record<string, unknown>).id) &&
        Number((person as Record<string, unknown>).id) > 0 &&
        typeof (person as Record<string, unknown>).name === "string" &&
        String((person as Record<string, unknown>).name).trim() ===
          (person as Record<string, unknown>).name &&
        String((person as Record<string, unknown>).name).length >= 1 &&
        String((person as Record<string, unknown>).name).length <= 200,
    );
  return (
    Number.isInteger(movie.id) &&
    Number(movie.id) > 0 &&
    peopleAreValid(movie.cast, 5) &&
    peopleAreValid(movie.directors, 3) &&
    (movie.runtimeMinutes === null ||
      (Number.isSafeInteger(movie.runtimeMinutes) &&
        Number(movie.runtimeMinutes) > 0)) &&
    (collection === null ||
      (typeof collection === "object" &&
        Number.isInteger((collection as Record<string, unknown>).id) &&
        Number((collection as Record<string, unknown>).id) > 0 &&
        typeof (collection as Record<string, unknown>).name === "string" &&
        String((collection as Record<string, unknown>).name).trim() ===
          (collection as Record<string, unknown>).name &&
        String((collection as Record<string, unknown>).name).length >= 1 &&
        String((collection as Record<string, unknown>).name).length <= 200))
  );
};

const readCache = (path: string): ReconciliationCache => {
  if (!existsSync(path)) {
    return { findEntries: {}, movieEntries: {}, schemaVersion: 4 };
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const findEntries =
      value.schemaVersion === 1 ? value.entries : value.findEntries;
    if (
      !findEntries ||
      typeof findEntries !== "object" ||
      Array.isArray(findEntries) ||
      Object.entries(findEntries).some(
        ([key, movies]) =>
          !/^tt\d{6,9}$/.test(key) ||
          !Array.isArray(movies) ||
          !movies.every(validCachedMovie),
      )
    ) {
      throw new Error("invalid cache entry");
    }
    if (
      value.schemaVersion === 1 ||
      value.schemaVersion === 2 ||
      value.schemaVersion === 3
    ) {
      return {
        findEntries: findEntries as Record<string, TmdbFindMovie[]>,
        movieEntries: {},
        schemaVersion: 4,
      };
    }
    if (
      value.schemaVersion !== 4 ||
      !value.movieEntries ||
      typeof value.movieEntries !== "object" ||
      Array.isArray(value.movieEntries) ||
      Object.entries(value.movieEntries).some(
        ([key, movie]) =>
          !/^\d+$/.test(key) ||
          !validCachedMovieDetail(movie) ||
          Number(key) !== movie.id,
      )
    ) {
      throw new Error("invalid cache");
    }
    return value as unknown as ReconciliationCache;
  } catch {
    throw new Error("The private TMDB cache is invalid");
  }
};

const wait = (milliseconds: number) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const writePrivateJson = (path: string, value: unknown) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
};

if (!inputArgument || !outputArgument || !reportArgument || !cacheArgument) {
  console.error(
    "Usage: pnpm import:reconcile -- <intermediate.json> <reconciliation.json> <report.json> <cache.json>",
  );
  process.exitCode = 2;
} else {
  try {
    if (!process.env.TMDB_READ_ACCESS_TOKEN && existsSync(".env")) {
      loadEnvFile(".env");
    }
    const token = process.env.TMDB_READ_ACCESS_TOKEN;
    if (!token) throw new Error("TMDB_READ_ACCESS_TOKEN is not configured");

    const inputPath = resolve(inputArgument);
    const outputPath = resolve(outputArgument);
    const reportPath = resolve(reportArgument);
    const cachePath = resolve(cacheArgument);
    const document = parseIntermediateJson(readFileSync(inputPath, "utf8"));
    if (!document) throw new Error("The generalized intermediate is invalid");
    const cache = readCache(cachePath);
    let uncachedFindLookups = 0;
    let uncachedMovieLookups = 0;
    let lastRequestAt = 0;

    const fetchProvider = async (path: string, parameters: URLSearchParams) => {
      const remainingDelay = 250 - (Date.now() - lastRequestAt);
      if (remainingDelay > 0) await wait(remainingDelay);
      lastRequestAt = Date.now();
      const url = new URL(path, "https://api.themoviedb.org");
      url.search = parameters.toString();
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("TMDB lookup failed");
      return response.json() as Promise<unknown>;
    };

    const findMovies = async (legacyImdbId: string) => {
      const cached = cache.findEntries[legacyImdbId];
      if (cached) return cached;

      const value = await fetchProvider(
        `/3/find/${encodeURIComponent(legacyImdbId)}`,
        new URLSearchParams({
          external_source: "imdb_id",
          language: "en-US",
        }),
      );
      const movies = parseTmdbFindResponse(value);
      if (!movies) throw new Error("TMDB returned an invalid response");

      cache.findEntries[legacyImdbId] = movies;
      writePrivateJson(cachePath, cache);
      uncachedFindLookups += 1;
      if (uncachedFindLookups % 50 === 0) {
        console.log(`Cached ${uncachedFindLookups} new TMDB find lookups`);
      }
      return movies;
    };

    const getMovie = async (tmdbId: number) => {
      const cacheKey = String(tmdbId);
      const cached = cache.movieEntries[cacheKey];
      if (cached) return cached;

      const value = await fetchProvider(
        `/3/movie/${tmdbId}`,
        new URLSearchParams({
          append_to_response: "credits",
          language: "en-US",
        }),
      );
      const movie = parseTmdbMovieResponse(value);
      if (!movie || movie.id !== tmdbId) {
        throw new Error("TMDB returned an invalid response");
      }

      cache.movieEntries[cacheKey] = movie;
      writePrivateJson(cachePath, cache);
      uncachedMovieLookups += 1;
      if (uncachedMovieLookups % 50 === 0) {
        console.log(`Cached ${uncachedMovieLookups} new TMDB movie lookups`);
      }
      return movie;
    };

    const result = await reconcileTmdb(
      document,
      findMovies,
      getMovie,
      new Date().toISOString(),
    );
    writePrivateJson(outputPath, result.document);
    writePrivateJson(reportPath, {
      complete: result.document.complete,
      counts: {
        confirmed: result.document.matches.length,
        diagnostics: result.diagnostics.length,
        uncachedFindLookups,
        uncachedMovieLookups,
      },
      diagnostics: result.diagnostics,
      schemaVersion: 3,
    });
    console.log(
      `Reconciliation ${result.document.complete ? "completed" : "stopped"}: ${result.document.matches.length} confirmed, ${result.diagnostics.length} review diagnostics, ${uncachedFindLookups} new find lookups, ${uncachedMovieLookups} new movie lookups`,
    );
    if (!result.document.complete) process.exitCode = 1;
  } catch (error) {
    fail(error instanceof Error ? error.message : "TMDB reconciliation failed");
  }
}
