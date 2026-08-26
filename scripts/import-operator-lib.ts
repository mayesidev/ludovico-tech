import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CATALOG_IMPORT_SCHEMA_VERSION } from "./catalog-import-lib";
import { IMPORT_ARTIFACT_SCHEMA_VERSION } from "./import-files";
import { assertReleaseMigrationsApplied } from "./release-gates";
import { parseWranglerConfig } from "./validate-cloudflare-config-lib";

const countSchema = z.number().int().nonnegative();
const countsSchema = z
  .object({
    collectionMemberships: countSchema,
    collections: countSchema,
    movies: countSchema,
    ratings: countSchema,
    tmdbLinks: countSchema,
  })
  .strict();
const chunkSchema = z
  .object({
    filename: z.string().regex(/^chunk-\d{4}\.sql$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const importedAtSchema = z.string().refine((value) => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
});
const catalogManifestSchema = z
  .object({
    artifactSchemaVersion: z.literal(IMPORT_ARTIFACT_SCHEMA_VERSION),
    artifactType: z.literal("catalog_import"),
    chunks: z.array(chunkSchema).min(1),
    counts: countsSchema,
    importedAt: importedAtSchema,
    nowShowingStatus: z.literal("empty"),
    schemaVersion: z.literal(CATALOG_IMPORT_SCHEMA_VERSION),
  })
  .strict();
const diagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    row: z.number().int().min(1).nullable(),
    severity: z.literal("error"),
  })
  .strict();
const validationReportSchema = z
  .object({
    diagnostics: z.array(diagnosticSchema).length(0),
    schemaVersion: z.literal(CATALOG_IMPORT_SCHEMA_VERSION),
    valid: z.literal(true),
  })
  .strict();

type CatalogManifest = z.infer<typeof catalogManifestSchema>;

export class ImportOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportOperatorError";
  }
}

type LoadedCatalogArtifact = {
  chunks: Array<{ filename: string; path: string }>;
  manifest: CatalogManifest;
};

export type ImportBundle = {
  catalog: LoadedCatalogArtifact;
};

const readJson = (path: string, label: string) => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new ImportOperatorError(`${label} is missing or invalid`);
  }
};

const expectedChunkFilename = (index: number) =>
  `chunk-${String(index + 1).padStart(4, "0")}.sql`;
const formatCount = (value: number, singular: string) =>
  `${value} ${singular}${value === 1 ? "" : "s"}`;

export const loadImportBundle = (catalogDirectory: string): ImportBundle => {
  const directory = resolve(catalogDirectory);
  const parsedManifest = catalogManifestSchema.safeParse(
    readJson(join(directory, "manifest.json"), "catalog_import manifest"),
  );
  if (!parsedManifest.success) {
    throw new ImportOperatorError("catalog_import manifest is invalid");
  }
  const manifest = parsedManifest.data;
  const report = validationReportSchema.safeParse(
    readJson(
      join(directory, "validation-report.json"),
      "catalog_import validation report",
    ),
  );
  if (!report.success) {
    throw new ImportOperatorError(
      "catalog_import validation report is invalid or failed",
    );
  }

  for (const [index, chunk] of manifest.chunks.entries()) {
    if (chunk.filename !== expectedChunkFilename(index)) {
      throw new ImportOperatorError(
        "catalog_import chunk sequence is not contiguous",
      );
    }
  }
  const manifestFilenames = manifest.chunks.map((chunk) => chunk.filename);
  let directoryFilenames: string[];
  try {
    directoryFilenames = readdirSync(directory)
      .filter((filename) => /^chunk-\d{4}\.sql$/.test(filename))
      .sort();
  } catch {
    throw new ImportOperatorError("catalog_import directory is unavailable");
  }
  if (
    JSON.stringify(directoryFilenames) !== JSON.stringify(manifestFilenames)
  ) {
    throw new ImportOperatorError(
      "catalog_import chunks do not match the manifest",
    );
  }

  const chunks = manifest.chunks.map((chunk) => {
    const path = join(directory, chunk.filename);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      throw new ImportOperatorError(
        `catalog_import chunk ${chunk.filename} is unavailable`,
      );
    }
    if (createHash("sha256").update(source).digest("hex") !== chunk.sha256) {
      throw new ImportOperatorError(
        `catalog_import chunk ${chunk.filename} failed its checksum`,
      );
    }
    return { filename: chunk.filename, path };
  });

  const counts = manifest.counts;
  if (
    counts.movies < 1 ||
    counts.ratings > counts.movies ||
    counts.collections > counts.movies ||
    counts.collectionMemberships > counts.movies ||
    counts.collectionMemberships < counts.collections ||
    counts.tmdbLinks > counts.movies
  ) {
    throw new ImportOperatorError("Import artifact counts are inconsistent");
  }

  return { catalog: { chunks, manifest } };
};

export type ImportEnvironment = string;

export type ImportOperatorOptions = {
  catalogDirectory: string;
  database: string;
  environment: ImportEnvironment;
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
    "--catalog",
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
  const catalogDirectory = values.get("--catalog");
  if (!environment || !/^[a-z][a-z0-9-]{0,62}$/.test(environment)) {
    throw new ImportOperatorError("--environment is missing or invalid");
  }
  const expectedDatabase = configuredDatabase(environment);
  if (!database || !catalogDirectory || database !== expectedDatabase) {
    throw new ImportOperatorError(
      `Database confirmation must be ${expectedDatabase}`,
    );
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
    catalogDirectory,
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
  (SELECT status FROM now_showing WHERE id = 1) AS now_showing_status`;
const migrationsQuery = "SELECT name FROM d1_migrations ORDER BY id";

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
    summary.nowShowingStatus !== "empty"
  ) {
    throw new ImportOperatorError(
      "The selected database is not an empty migrated import target",
    );
  }
};

const assertImportedDatabase = (
  summary: DatabaseSummary,
  bundle: ImportBundle,
) => {
  const expected = bundle.catalog.manifest.counts;
  if (
    summary.collectionMemberships !== expected.collectionMemberships ||
    summary.collections !== expected.collections ||
    summary.movies !== expected.movies ||
    summary.ratings !== expected.ratings ||
    summary.tmdbLinks !== expected.tmdbLinks ||
    summary.nowShowingStatus !== "empty"
  ) {
    throw new ImportOperatorError(
      "Post-import database verification did not match the manifest",
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

export const executeImportBundle = async (
  bundle: ImportBundle,
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

  for (const [index, chunk] of bundle.catalog.chunks.entries()) {
    log(
      `Applying catalog_import ${chunk.filename} (${index + 1}/${bundle.catalog.chunks.length})`,
    );
    try {
      await runWrangler(
        runner,
        options,
        ["--file", chunk.path],
        "Import chunk failed",
      );
    } catch {
      throw new ImportOperatorError(
        `catalog_import ${chunk.filename} failed; do not rerun against this target without a reviewed pre-release reset`,
      );
    }
  }

  const afterSource = await runWrangler(
    runner,
    options,
    ["--command", databaseSummaryQuery],
    "Post-import database verification failed; do not rerun against this target without review",
  );
  try {
    assertImportedDatabase(parseDatabaseSummary(afterSource), bundle);
  } catch {
    throw new ImportOperatorError(
      "Post-import database verification failed; do not rerun against this target without review",
    );
  }
  const counts = bundle.catalog.manifest.counts;
  log(
    `Verified ${formatCount(counts.movies, "movie")}, ${formatCount(counts.collections, "collection")}, ${formatCount(counts.collectionMemberships, "collection membership")}, ${formatCount(counts.ratings, "rating")}, and ${formatCount(counts.tmdbLinks, "TMDB link")}`,
  );
};

export const importPreflightSummary = (bundle: ImportBundle) => {
  const counts = bundle.catalog.manifest.counts;
  return `Preflight passed: ${formatCount(bundle.catalog.chunks.length, "catalog chunk")}, ${formatCount(counts.movies, "movie")}, ${formatCount(counts.collections, "collection")}, ${formatCount(counts.collectionMemberships, "collection membership")}, ${formatCount(counts.ratings, "rating")}, ${formatCount(counts.tmdbLinks, "TMDB link")}`;
};
