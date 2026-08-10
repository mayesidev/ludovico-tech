import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseIntermediateJson } from "./import-sheet-lib";
import {
  parseTmdbFindResponse,
  reconcileTmdb,
  type TmdbFindMovie,
} from "./reconcile-tmdb-lib";

type ReconciliationCache = {
  entries: Record<string, TmdbFindMovie[]>;
  schemaVersion: 1;
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

const readCache = (path: string): ReconciliationCache => {
  if (!existsSync(path)) return { entries: {}, schemaVersion: 1 };
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      value.schemaVersion !== 1 ||
      !value.entries ||
      typeof value.entries !== "object" ||
      Array.isArray(value.entries)
    ) {
      throw new Error("invalid cache");
    }
    const entries = value.entries as Record<string, unknown>;
    if (
      Object.entries(entries).some(
        ([key, movies]) =>
          !/^tt\d{6,9}$/.test(key) ||
          !Array.isArray(movies) ||
          !movies.every(validCachedMovie),
      )
    ) {
      throw new Error("invalid cache entry");
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
    let uncachedLookups = 0;
    let lastRequestAt = 0;

    const findMovies = async (legacyImdbId: string) => {
      const cached = cache.entries[legacyImdbId];
      if (cached) return cached;

      const remainingDelay = 250 - (Date.now() - lastRequestAt);
      if (remainingDelay > 0) await wait(remainingDelay);
      lastRequestAt = Date.now();
      const url = new URL(
        `/3/find/${encodeURIComponent(legacyImdbId)}`,
        "https://api.themoviedb.org",
      );
      url.search = new URLSearchParams({
        external_source: "imdb_id",
        language: "en-US",
      }).toString();
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("TMDB lookup failed");
      const movies = parseTmdbFindResponse(await response.json());
      if (!movies) throw new Error("TMDB returned an invalid response");

      cache.entries[legacyImdbId] = movies;
      writePrivateJson(cachePath, cache);
      uncachedLookups += 1;
      if (uncachedLookups % 50 === 0) {
        console.log(`Cached ${uncachedLookups} new TMDB lookups`);
      }
      return movies;
    };

    const result = await reconcileTmdb(
      document,
      findMovies,
      new Date().toISOString(),
    );
    writePrivateJson(outputPath, result.document);
    writePrivateJson(reportPath, {
      complete: result.document.complete,
      counts: {
        confirmed: result.document.matches.length,
        diagnostics: result.diagnostics.length,
        uncachedLookups,
      },
      diagnostics: result.diagnostics,
      schemaVersion: 1,
    });
    console.log(
      `Reconciliation ${result.document.complete ? "completed" : "stopped"}: ${result.document.matches.length} confirmed, ${result.diagnostics.length} review diagnostics, ${uncachedLookups} new lookups`,
    );
    if (!result.document.complete) process.exitCode = 1;
  } catch (error) {
    fail(error instanceof Error ? error.message : "TMDB reconciliation failed");
  }
}
