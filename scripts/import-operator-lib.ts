import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { renderSqlChunks, type CatalogImportPlan } from "./catalog-import-lib";
import { assertReleaseMigrationsApplied } from "./release-gates";
import { parseWranglerConfig } from "./validate-cloudflare-config-lib";

export class ImportOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportOperatorError";
  }
}

export type ImportOperatorOptions = {
  csvPath: string;
  database: string;
  environment: string;
  execute: boolean;
  persistTo: string | null;
};

const configuredDatabase = (environment: string) => {
  try {
    const config = parseWranglerConfig(
      readFileSync(resolve("wrangler.jsonc"), "utf8"),
    );
    const databases = config.env?.[environment]?.d1_databases ?? [];
    if (
      databases.length !== 1 ||
      databases[0]?.binding !== "DB" ||
      !databases[0].database_name
    ) {
      throw new Error();
    }
    return databases[0].database_name;
  } catch {
    throw new ImportOperatorError(
      `Environment ${environment} is not configured for catalog imports`,
    );
  }
};

export const parseImportOperatorArguments = (
  arguments_: string[],
): ImportOperatorOptions => {
  const values = new Map<string, string>();
  let execute = false;
  const valueFlags = new Set([
    "--csv",
    "--database",
    "--environment",
    "--persist-to",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      if (execute) {
        throw new ImportOperatorError("--execute was provided twice");
      }
      execute = true;
      continue;
    }
    if (!valueFlags.has(argument) || values.has(argument)) {
      throw new ImportOperatorError(`Unknown or repeated option ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ImportOperatorError(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }

  const environment = values.get("--environment");
  const database = values.get("--database");
  const csvPath = values.get("--csv");
  if (!environment || !/^[a-z][a-z0-9-]{0,62}$/.test(environment)) {
    throw new ImportOperatorError("--environment is missing or invalid");
  }
  const expectedDatabase = configuredDatabase(environment);
  if (!database || database !== expectedDatabase) {
    throw new ImportOperatorError(
      `Database confirmation must be ${expectedDatabase}`,
    );
  }
  if (!csvPath) {
    throw new ImportOperatorError("--csv is required");
  }
  const persistTo = values.get("--persist-to") ?? null;
  if (environment === "development" && execute && !persistTo) {
    throw new ImportOperatorError(
      "Development execution requires an isolated --persist-to directory",
    );
  }
  if (environment !== "development" && persistTo) {
    throw new ImportOperatorError(
      "--persist-to is available only for development",
    );
  }
  return {
    csvPath,
    database,
    environment,
    execute,
    persistTo,
  };
};

export type CommandRunner = (
  executable: string,
  arguments_: string[],
) => Promise<string>;

type DatabaseSummary = {
  collectionMemberships: number;
  collections: number;
  movies: number;
  nowShowingCollectionId: string | null;
  nowShowingMovieId: string | null;
  nowShowingStatus: "empty" | "ready" | "watched";
  ratings: number;
  tmdbLinks: number;
};

const databaseSummaryQuery = `SELECT
  (SELECT COUNT(*) FROM movies) AS movies,
  (SELECT COUNT(*) FROM collections) AS collections,
  (SELECT COUNT(*) FROM collection_movies) AS collection_memberships,
  (SELECT COUNT(*) FROM ratings) AS ratings,
  (SELECT COUNT(*) FROM movie_tmdb_data) AS tmdb_links,
  (SELECT CASE
     WHEN now_showing.movie_id IS NULL THEN 'empty'
     WHEN EXISTS (
       SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
     ) THEN 'watched'
     ELSE 'ready'
   END FROM now_showing WHERE id = 1) AS now_showing_status,
  (SELECT movie_id FROM now_showing WHERE id = 1) AS now_showing_movie_id,
  (SELECT collection_movies.collection_id
   FROM now_showing
   LEFT JOIN collection_movies ON collection_movies.movie_id = now_showing.movie_id
   WHERE now_showing.id = 1) AS now_showing_collection_id`;
const migrationsQuery = "SELECT name FROM d1_migrations ORDER BY id";
const countSchema = z.number().int().nonnegative();
const d1ResponseSchema = z
  .array(
    z
      .object({
        results: z.array(z.record(z.string(), z.unknown())),
        success: z.literal(true),
      })
      .passthrough(),
  )
  .length(1);
const summaryRowSchema = z
  .object({
    collection_memberships: countSchema,
    collections: countSchema,
    movies: countSchema,
    now_showing_collection_id: z.string().nullable(),
    now_showing_movie_id: z.string().nullable(),
    now_showing_status: z.enum(["empty", "ready", "watched"]),
    ratings: countSchema,
    tmdb_links: countSchema,
  })
  .passthrough();

const parseD1Response = (source: string, label: string) => {
  try {
    const parsed = d1ResponseSchema.safeParse(JSON.parse(source));
    if (!parsed.success) throw new Error();
    return parsed.data;
  } catch {
    throw new ImportOperatorError(`${label} returned invalid data`);
  }
};

const parseDatabaseSummary = (source: string): DatabaseSummary => {
  const response = parseD1Response(source, "Database verification");
  const row = summaryRowSchema.safeParse(response[0].results[0]);
  if (!row.success || response[0].results.length !== 1) {
    throw new ImportOperatorError(
      "Database verification returned invalid data",
    );
  }
  return {
    collectionMemberships: row.data.collection_memberships,
    collections: row.data.collections,
    movies: row.data.movies,
    nowShowingCollectionId: row.data.now_showing_collection_id,
    nowShowingMovieId: row.data.now_showing_movie_id,
    nowShowingStatus: row.data.now_showing_status,
    ratings: row.data.ratings,
    tmdbLinks: row.data.tmdb_links,
  };
};

const assertEmptyDatabase = (summary: DatabaseSummary) => {
  if (
    summary.collectionMemberships !== 0 ||
    summary.collections !== 0 ||
    summary.movies !== 0 ||
    summary.ratings !== 0 ||
    summary.tmdbLinks !== 0 ||
    summary.nowShowingStatus !== "empty" ||
    summary.nowShowingMovieId !== null ||
    summary.nowShowingCollectionId !== null
  ) {
    throw new ImportOperatorError(
      "The selected database is not an empty migrated import target",
    );
  }
};

const assertImportedDatabase = (
  summary: DatabaseSummary,
  plan: CatalogImportPlan,
) => {
  const expected = plan.counts;
  if (
    summary.collectionMemberships !== expected.collectionMemberships ||
    summary.collections !== expected.collections ||
    summary.movies !== expected.movies ||
    summary.ratings !== expected.ratings ||
    summary.tmdbLinks !== expected.tmdbLinks ||
    summary.nowShowingStatus !== (plan.nowShowing ? "ready" : "empty") ||
    summary.nowShowingMovieId !== (plan.nowShowing?.movieId ?? null) ||
    summary.nowShowingCollectionId !== (plan.nowShowing?.collectionId ?? null)
  ) {
    throw new ImportOperatorError(
      "Post-import database verification did not match the CSV",
    );
  }
};

const targetArguments = (options: ImportOperatorOptions) => [
  options.environment === "development" ? "--local" : "--remote",
  "--env",
  options.environment,
  ...(options.persistTo ? ["--persist-to", resolve(options.persistTo)] : []),
  "--experimental-auto-create=false",
  "--experimental-provision=false",
  "--yes",
  "--json",
];

const runSafely = async (
  runner: CommandRunner,
  executable: string,
  arguments_: string[],
  failureMessage: string,
) => {
  try {
    return await runner(executable, arguments_);
  } catch {
    throw new ImportOperatorError(failureMessage);
  }
};

const runWrangler = (
  runner: CommandRunner,
  options: ImportOperatorOptions,
  commandArguments: string[],
  failureMessage: string,
) =>
  runSafely(
    runner,
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      ...targetArguments(options),
      ...commandArguments,
    ],
    failureMessage,
  );

const migrationNames = () =>
  readdirSync(resolve("migrations"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

const formatCount = (value: number, singular: string) =>
  `${value} ${singular}${value === 1 ? "" : "s"}`;

export const importPreflightSummary = (plan: CatalogImportPlan) => {
  const counts = plan.counts;
  const nowShowing = plan.nowShowing
    ? "Now Showing selected"
    : "Now Showing empty";
  return `Preflight passed: ${formatCount(counts.movies, "movie")}, ${formatCount(counts.collections, "collection")}, ${formatCount(counts.collectionMemberships, "collection membership")}, ${formatCount(counts.ratings, "rating")}, ${formatCount(counts.tmdbLinks, "TMDB link")}, ${nowShowing}`;
};

export const executeCatalogImport = async (
  plan: CatalogImportPlan,
  options: ImportOperatorOptions,
  runner: CommandRunner,
  log: (message: string) => void,
) => {
  if (!options.execute) return;
  if (configuredDatabase(options.environment) !== options.database) {
    throw new ImportOperatorError("Target configuration validation failed");
  }
  await runSafely(
    runner,
    "pnpm",
    ["config:check"],
    "Target configuration validation failed",
  );

  const migrationsSource = await runWrangler(
    runner,
    options,
    ["--command", migrationsQuery],
    "Migration verification failed",
  );
  try {
    assertReleaseMigrationsApplied(
      migrationNames(),
      JSON.parse(migrationsSource) as unknown,
    );
  } catch {
    throw new ImportOperatorError("Migration verification failed");
  }

  const beforeSource = await runWrangler(
    runner,
    options,
    ["--command", databaseSummaryQuery],
    "Empty-target verification failed",
  );
  assertEmptyDatabase(parseDatabaseSummary(beforeSource));

  const chunks = renderSqlChunks(plan.statements);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ludovico-import-"));
  try {
    const paths = chunks.map((sql, index) => {
      const filename = `chunk-${String(index + 1).padStart(4, "0")}.sql`;
      const path = join(temporaryDirectory, filename);
      writeFileSync(path, sql, { flag: "wx", mode: 0o600 });
      return path;
    });
    for (const [index, path] of paths.entries()) {
      log(`Applying ${basename(path)} (${index + 1}/${chunks.length})`);
      try {
        await runWrangler(
          runner,
          options,
          ["--file", path],
          "Import chunk failed",
        );
      } catch {
        throw new ImportOperatorError(
          `${basename(path)} failed; do not rerun against this target without a reviewed pre-release reset`,
        );
      }
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  const afterSource = await runWrangler(
    runner,
    options,
    ["--command", databaseSummaryQuery],
    "Post-import database verification failed; do not rerun against this target without review",
  );
  try {
    assertImportedDatabase(parseDatabaseSummary(afterSource), plan);
  } catch {
    throw new ImportOperatorError(
      "Post-import database verification failed; do not rerun against this target without review",
    );
  }
  const counts = plan.counts;
  log(
    `Verified ${formatCount(counts.movies, "movie")}, ${formatCount(counts.collections, "collection")}, ${formatCount(counts.collectionMemberships, "collection membership")}, ${formatCount(counts.ratings, "rating")}, and ${formatCount(counts.tmdbLinks, "TMDB link")}`,
  );
};
