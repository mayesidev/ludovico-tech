import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { IMPORT_ARTIFACT_SCHEMA_VERSION } from "./import-files";
import { INTERMEDIATE_SCHEMA_VERSION } from "./import-sheet-lib";
import { assertReleaseMigrationsApplied } from "./release-gates";

const countSchema = z.number().int().nonnegative();
const countsSchema = z
  .object({
    collections: countSchema,
    movies: countSchema,
    ratings: countSchema,
    sources: countSchema,
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
const manifestBase = z
  .object({
    artifactSchemaVersion: z.literal(IMPORT_ARTIFACT_SCHEMA_VERSION),
    chunks: z.array(chunkSchema).min(1),
    counts: countsSchema,
    importedAt: importedAtSchema,
    schemaVersion: z.literal(INTERMEDIATE_SCHEMA_VERSION),
  })
  .strict();
const catalogManifestSchema = manifestBase.extend({
  artifactType: z.literal("catalog_import"),
  nowShowingStatus: z.enum(["empty", "pending_order", "ready"]),
});
const metadataManifestSchema = manifestBase.extend({
  artifactType: z.literal("tmdb_metadata"),
  nowShowingStatus: z.null(),
});
const diagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    row: z.number().int().min(2).nullable(),
    severity: z.enum(["error", "warning"]),
  })
  .strict();
const validationReportSchema = z
  .object({
    diagnostics: z.array(diagnosticSchema),
    schemaVersion: z.literal(INTERMEDIATE_SCHEMA_VERSION),
    valid: z.literal(true),
  })
  .strict()
  .refine(
    (report) =>
      !report.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  );

type CatalogManifest = z.infer<typeof catalogManifestSchema>;
type MetadataManifest = z.infer<typeof metadataManifestSchema>;
type ImportManifest = CatalogManifest | MetadataManifest;
type ArtifactType = ImportManifest["artifactType"];

export class ImportOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportOperatorError";
  }
}

type LoadedArtifact<TManifest extends ImportManifest> = {
  chunks: Array<{ filename: string; path: string }>;
  diagnosticCodes: string[];
  manifest: TManifest;
};

export type ImportBundle = {
  catalog: LoadedArtifact<CatalogManifest>;
  metadata: LoadedArtifact<MetadataManifest>;
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

const loadArtifact = <TManifest extends ImportManifest>(
  directoryArgument: string,
  artifactType: ArtifactType,
): LoadedArtifact<TManifest> => {
  const directory = resolve(directoryArgument);
  const manifestSource = readJson(
    join(directory, "manifest.json"),
    `${artifactType} manifest`,
  );
  const parsedManifest =
    artifactType === "catalog_import"
      ? catalogManifestSchema.safeParse(manifestSource)
      : metadataManifestSchema.safeParse(manifestSource);
  if (!parsedManifest.success) {
    throw new ImportOperatorError(`${artifactType} manifest is invalid`);
  }
  const manifest = parsedManifest.data as TManifest;
  const report = validationReportSchema.safeParse(
    readJson(
      join(directory, "validation-report.json"),
      `${artifactType} validation report`,
    ),
  );
  if (!report.success) {
    throw new ImportOperatorError(
      `${artifactType} validation report is invalid or failed`,
    );
  }

  for (const [index, chunk] of manifest.chunks.entries()) {
    if (chunk.filename !== expectedChunkFilename(index)) {
      throw new ImportOperatorError(
        `${artifactType} chunk sequence is not contiguous`,
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
    throw new ImportOperatorError(`${artifactType} directory is unavailable`);
  }
  if (
    JSON.stringify(directoryFilenames) !== JSON.stringify(manifestFilenames)
  ) {
    throw new ImportOperatorError(
      `${artifactType} chunks do not match the manifest`,
    );
  }

  const chunks = manifest.chunks.map((chunk) => {
    const path = join(directory, chunk.filename);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      throw new ImportOperatorError(
        `${artifactType} chunk ${chunk.filename} is unavailable`,
      );
    }
    if (createHash("sha256").update(source).digest("hex") !== chunk.sha256) {
      throw new ImportOperatorError(
        `${artifactType} chunk ${chunk.filename} failed its checksum`,
      );
    }
    return { filename: chunk.filename, path };
  });

  return {
    chunks,
    diagnosticCodes: [
      ...new Set(report.data.diagnostics.map((diagnostic) => diagnostic.code)),
    ].sort(),
    manifest,
  };
};

export const loadImportBundle = (
  catalogDirectory: string,
  metadataDirectory: string,
): ImportBundle => {
  const catalog = loadArtifact<CatalogManifest>(
    catalogDirectory,
    "catalog_import",
  );
  const metadata = loadArtifact<MetadataManifest>(
    metadataDirectory,
    "tmdb_metadata",
  );
  if (
    catalog.manifest.counts.movies < 1 ||
    catalog.manifest.counts.sources < catalog.manifest.counts.movies ||
    catalog.manifest.counts.ratings > catalog.manifest.counts.movies ||
    catalog.manifest.counts.collections > catalog.manifest.counts.movies ||
    metadata.manifest.counts.collections !== 0 ||
    metadata.manifest.counts.ratings !== 0 ||
    metadata.manifest.counts.sources !== 0 ||
    metadata.manifest.counts.movies > catalog.manifest.counts.movies
  ) {
    throw new ImportOperatorError("Import artifact counts are inconsistent");
  }
  return { catalog, metadata };
};

export type ImportEnvironment = "development" | "production" | "staging";

export type ImportOperatorOptions = {
  catalogDirectory: string;
  database: string;
  environment: ImportEnvironment;
  execute: boolean;
  metadataDirectory: string;
  persistTo: string | null;
};

const expectedDatabase = (environment: ImportEnvironment) =>
  `ludovico-tech-${environment}`;

export const parseImportOperatorArguments = (
  arguments_: string[],
): ImportOperatorOptions => {
  const values = new Map<string, string>();
  let execute = false;
  const valueFlags = new Set([
    "--catalog",
    "--database",
    "--environment",
    "--metadata",
    "--persist-to",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      if (execute)
        throw new ImportOperatorError("--execute was provided twice");
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
  const metadataDirectory = values.get("--metadata");
  if (
    environment !== "development" &&
    environment !== "staging" &&
    environment !== "production"
  ) {
    throw new ImportOperatorError(
      "--environment must be development, staging, or production",
    );
  }
  if (
    !database ||
    !catalogDirectory ||
    !metadataDirectory ||
    database !== expectedDatabase(environment)
  ) {
    throw new ImportOperatorError(
      `Database confirmation must be ${expectedDatabase(environment)}`,
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
    metadataDirectory,
    persistTo,
  };
};

export type CommandRunner = (
  executable: string,
  arguments_: string[],
) => Promise<string>;

type DatabaseSummary = {
  collections: number;
  movies: number;
  nowShowingStatus: "empty" | "pending_order" | "ready" | "watched";
  ratings: number;
  sources: number;
  tmdbMovies: number;
};

const databaseSummaryQuery = `SELECT
  (SELECT COUNT(*) FROM movies) AS movies,
  (SELECT COUNT(*) FROM collections) AS collections,
  (SELECT COUNT(*) FROM ratings) AS ratings,
  (SELECT COUNT(*) FROM movie_import_sources) AS sources,
  (SELECT COUNT(*) FROM movies WHERE tmdb_id IS NOT NULL) AS tmdb_movies,
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
    collections: countSchema,
    movies: countSchema,
    now_showing_status: z.enum(["empty", "pending_order", "ready", "watched"]),
    ratings: countSchema,
    sources: countSchema,
    tmdb_movies: countSchema,
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
    collections: row.data.collections,
    movies: row.data.movies,
    nowShowingStatus: row.data.now_showing_status,
    ratings: row.data.ratings,
    sources: row.data.sources,
    tmdbMovies: row.data.tmdb_movies,
  };
};

const assertEmptyDatabase = (summary: DatabaseSummary) => {
  if (
    summary.collections !== 0 ||
    summary.movies !== 0 ||
    summary.ratings !== 0 ||
    summary.sources !== 0 ||
    summary.tmdbMovies !== 0 ||
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
    summary.collections !== expected.collections ||
    summary.movies !== expected.movies ||
    summary.ratings !== expected.ratings ||
    summary.sources !== expected.sources ||
    summary.tmdbMovies !== bundle.metadata.manifest.counts.movies ||
    summary.nowShowingStatus !== bundle.catalog.manifest.nowShowingStatus
  ) {
    throw new ImportOperatorError(
      "Post-import database verification did not match the manifests",
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
  const configCommand =
    options.environment === "development"
      ? "config:check"
      : `config:check:${options.environment}`;
  await runSafely(
    runner,
    "pnpm",
    [configCommand],
    "Target configuration validation failed",
  );

  const migrationsSource = await runWrangler(
    runner,
    options,
    ["--command", migrationsQuery],
    "Migration verification failed",
  );
  let migrations: unknown;
  try {
    migrations = JSON.parse(migrationsSource) as unknown;
    assertReleaseMigrationsApplied(migrationNames(), migrations);
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

  for (const artifact of [bundle.catalog, bundle.metadata]) {
    for (const [index, chunk] of artifact.chunks.entries()) {
      log(
        `Applying ${artifact.manifest.artifactType} ${chunk.filename} (${index + 1}/${artifact.chunks.length})`,
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
          `${artifact.manifest.artifactType} ${chunk.filename} failed; do not rerun against this target without a reviewed pre-release reset`,
        );
      }
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
  log(
    `Verified ${bundle.catalog.manifest.counts.movies} movies, ${bundle.catalog.manifest.counts.collections} collections, and ${bundle.catalog.manifest.counts.ratings} ratings`,
  );
};

export const importPreflightSummary = (bundle: ImportBundle) => {
  const diagnosticCodes = [
    ...new Set([
      ...bundle.catalog.diagnosticCodes,
      ...bundle.metadata.diagnosticCodes,
    ]),
  ].sort();
  const counts = bundle.catalog.manifest.counts;
  const count = (value: number, singular: string) =>
    `${value} ${singular}${value === 1 ? "" : "s"}`;
  return `Preflight passed: ${count(bundle.catalog.chunks.length, "catalog chunk")}, ${count(bundle.metadata.chunks.length, "metadata chunk")}, ${count(counts.movies, "movie")}, ${count(counts.collections, "collection")}, ${count(counts.ratings, "rating")}${diagnosticCodes.length ? `; diagnostics: ${diagnosticCodes.join(", ")}` : ""}`;
};
