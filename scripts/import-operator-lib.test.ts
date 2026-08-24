import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeImportArtifacts } from "./import-files";
import {
  executeImportBundle,
  importPreflightSummary,
  ImportOperatorError,
  loadImportBundle,
  parseImportOperatorArguments,
  type CommandRunner,
  type ImportOperatorOptions,
} from "./import-operator-lib";

const temporaryDirectories: string[] = [];
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "ludovico-operator-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const createArtifactBundle = () => {
  const root = temporaryDirectory();
  const catalogDirectory = join(root, "catalog");
  const metadataDirectory = join(root, "metadata");
  writeImportArtifacts(
    catalogDirectory,
    [
      { filename: "chunk-0001.sql", sql: "SELECT 'catalog one';\n" },
      { filename: "chunk-0002.sql", sql: "SELECT 'catalog two';\n" },
    ],
    { collections: 1, movies: 2, ratings: 1, sources: 2 },
    "2026-08-10T12:00:00.000Z",
    [{ code: "COLLECTION_INDICATOR_UNCERTAIN", row: 2, severity: "warning" }],
    { artifactType: "catalog_import", nowShowingStatus: "ready" },
  );
  writeImportArtifacts(
    metadataDirectory,
    [{ filename: "chunk-0001.sql", sql: "SELECT 'metadata';\n" }],
    { collections: 0, movies: 1, ratings: 0, sources: 0 },
    "2026-08-10T12:00:00.000Z",
    [],
    { artifactType: "tmdb_metadata", nowShowingStatus: null },
  );
  return { catalogDirectory, metadataDirectory };
};

const loadSyntheticBundle = () => {
  const directories = createArtifactBundle();
  return {
    ...directories,
    bundle: loadImportBundle(
      directories.catalogDirectory,
      directories.metadataDirectory,
    ),
  };
};

const productionOptions = (
  directories: ReturnType<typeof createArtifactBundle>,
): ImportOperatorOptions => ({
  catalogDirectory: directories.catalogDirectory,
  database: "ludovico-tech-production",
  environment: "production",
  execute: true,
  metadataDirectory: directories.metadataDirectory,
  persistTo: null,
});

const d1Response = (results: Array<Record<string, unknown>>) =>
  JSON.stringify([{ results, success: true }]);

const summary = (overrides: Record<string, unknown> = {}) =>
  d1Response([
    {
      collections: 0,
      movies: 0,
      now_showing_status: "empty",
      ratings: 0,
      sources: 0,
      tmdb_movies: 0,
      ...overrides,
    },
  ]);

const migrationResponse = () =>
  d1Response(
    readdirSync("migrations")
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .map((name) => ({ name })),
  );

describe("private import artifact preflight", () => {
  it("loads only a complete, ordered, checksummed artifact pair", () => {
    const { bundle } = loadSyntheticBundle();

    expect(bundle.catalog.chunks.map((chunk) => chunk.filename)).toEqual([
      "chunk-0001.sql",
      "chunk-0002.sql",
    ]);
    expect(importPreflightSummary(bundle)).toBe(
      "Preflight passed: 2 catalog chunks, 1 metadata chunk, 2 movies, 1 collection, 1 rating; diagnostics: COLLECTION_INDICATOR_UNCERTAIN",
    );
  });

  it("accepts a catalog-only import for Worker-managed TMDB enrichment", () => {
    const { catalogDirectory } = createArtifactBundle();
    const bundle = loadImportBundle(catalogDirectory);

    expect(bundle.metadata).toBeNull();
    expect(importPreflightSummary(bundle)).toBe(
      "Preflight passed: 2 catalog chunks, 2 movies, 1 collection, 1 rating; diagnostics: COLLECTION_INDICATOR_UNCERTAIN",
    );
  });

  it("rejects a chunk whose private contents changed after generation", () => {
    const directories = createArtifactBundle();
    writeFileSync(
      join(directories.catalogDirectory, "chunk-0001.sql"),
      "SELECT 'changed';\n",
    );

    expect(() =>
      loadImportBundle(
        directories.catalogDirectory,
        directories.metadataDirectory,
      ),
    ).toThrow("catalog_import chunk chunk-0001.sql failed its checksum");
  });

  it("rejects out-of-order manifest chunks", () => {
    const directories = createArtifactBundle();
    const manifestPath = join(directories.catalogDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      chunks: unknown[];
    };
    manifest.chunks.reverse();
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() =>
      loadImportBundle(
        directories.catalogDirectory,
        directories.metadataDirectory,
      ),
    ).toThrow("catalog_import chunk sequence is not contiguous");
  });

  it("rejects a chunk file that is not declared by the manifest", () => {
    const directories = createArtifactBundle();
    writeFileSync(
      join(directories.catalogDirectory, "chunk-0003.sql"),
      "SELECT 'undeclared';\n",
    );

    expect(() =>
      loadImportBundle(
        directories.catalogDirectory,
        directories.metadataDirectory,
      ),
    ).toThrow("catalog_import chunks do not match the manifest");
  });

  it("rejects an invalid or failed validation report", () => {
    const directories = createArtifactBundle();
    writeFileSync(
      join(directories.catalogDirectory, "validation-report.json"),
      JSON.stringify({
        diagnostics: [{ code: "SOURCE_EMPTY", row: null, severity: "error" }],
        schemaVersion: 3,
        valid: false,
      }),
    );

    expect(() =>
      loadImportBundle(
        directories.catalogDirectory,
        directories.metadataDirectory,
      ),
    ).toThrow("catalog_import validation report is invalid or failed");
  });

  it("rejects an obsolete catalog artifact that can restore pending order", () => {
    const directories = createArtifactBundle();
    const manifestPath = join(directories.catalogDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.artifactSchemaVersion = 1;
    manifest.nowShowingStatus = "pending_order";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() =>
      loadImportBundle(
        directories.catalogDirectory,
        directories.metadataDirectory,
      ),
    ).toThrow("catalog_import manifest is invalid");
  });
});

describe("private import target confirmation", () => {
  const requiredArguments = [
    "--environment",
    "production",
    "--database",
    "ludovico-tech-production",
    "--catalog",
    "private-catalog",
    "--metadata",
    "private-metadata",
  ];

  it("defaults to a no-contact preflight", () => {
    expect(parseImportOperatorArguments(requiredArguments)).toMatchObject({
      database: "ludovico-tech-production",
      environment: "production",
      execute: false,
    });
  });

  it("does not require a TMDB metadata artifact", () => {
    expect(
      parseImportOperatorArguments(
        requiredArguments.slice(0, requiredArguments.indexOf("--metadata")),
      ),
    ).toMatchObject({
      execute: false,
      metadataDirectory: null,
    });
  });

  it("rejects a database name that does not exactly match the environment", () => {
    expect(() =>
      parseImportOperatorArguments(
        requiredArguments.map((value) =>
          value === "ludovico-tech-production"
            ? "ludovico-tech-staging"
            : value,
        ),
      ),
    ).toThrow("Database confirmation must be ludovico-tech-production");
  });

  it("requires isolated persistence for a local execution", () => {
    expect(() =>
      parseImportOperatorArguments([
        ...requiredArguments.map((value) =>
          value === "production"
            ? "development"
            : value === "ludovico-tech-production"
              ? "ludovico-tech-development"
              : value,
        ),
        "--execute",
      ]),
    ).toThrow(
      "Development execution requires an isolated --persist-to directory",
    );
  });
});

describe("private import execution", () => {
  it("applies a catalog without requiring a metadata phase", async () => {
    const directories = createArtifactBundle();
    const bundle = loadImportBundle(directories.catalogDirectory);
    const options = {
      ...productionOptions(directories),
      metadataDirectory: null,
    };
    const calls: Array<{ arguments_: string[]; executable: string }> = [];
    let summaryCall = 0;
    const runner: CommandRunner = async (executable, arguments_) => {
      calls.push({ arguments_, executable });
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--command")) {
        summaryCall += 1;
        return summaryCall === 1
          ? summary()
          : summary({
              collections: 1,
              movies: 2,
              now_showing_status: "ready",
              ratings: 1,
              sources: 2,
            });
      }
      return "[]";
    };

    await executeImportBundle(bundle, options, runner, vi.fn());

    expect(
      calls.filter((call) => call.arguments_.includes("--file")),
    ).toHaveLength(2);
  });

  it("verifies the target, applies catalog before metadata, and verifies counts", async () => {
    const directories = createArtifactBundle();
    const bundle = loadImportBundle(
      directories.catalogDirectory,
      directories.metadataDirectory,
    );
    const calls: Array<{ arguments_: string[]; executable: string }> = [];
    let summaryCall = 0;
    const runner: CommandRunner = async (executable, arguments_) => {
      calls.push({ arguments_, executable });
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--command")) {
        summaryCall += 1;
        return summaryCall === 1
          ? summary()
          : summary({
              collections: 1,
              movies: 2,
              now_showing_status: "ready",
              ratings: 1,
              sources: 2,
              tmdb_movies: 1,
            });
      }
      return "[]";
    };
    const log = vi.fn();

    await executeImportBundle(
      bundle,
      productionOptions(directories),
      runner,
      log,
    );

    expect(calls[0]).toEqual({
      arguments_: ["config:check:production"],
      executable: "pnpm",
    });
    const fileCalls = calls.filter((call) =>
      call.arguments_.includes("--file"),
    );
    expect(
      fileCalls.map((call) =>
        basename(call.arguments_[call.arguments_.indexOf("--file") + 1]),
      ),
    ).toEqual(["chunk-0001.sql", "chunk-0002.sql", "chunk-0001.sql"]);
    for (const call of calls.slice(1)) {
      expect(call.arguments_).toEqual(
        expect.arrayContaining([
          "--remote",
          "--env",
          "production",
          "--experimental-auto-create=false",
          "--experimental-provision=false",
        ]),
      );
    }
    expect(log).toHaveBeenLastCalledWith(
      "Verified 2 movies, 1 collections, and 1 ratings",
    );
  });

  it("refuses to apply any chunk to a non-empty target", async () => {
    const { bundle, ...directories } = loadSyntheticBundle();
    const runner = vi.fn<CommandRunner>(async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      return summary({ movies: 1 });
    });

    await expect(
      executeImportBundle(
        bundle,
        productionOptions(directories),
        runner,
        vi.fn(),
      ),
    ).rejects.toThrow("not an empty migrated import target");
    expect(
      runner.mock.calls.some(([, arguments_]) => arguments_.includes("--file")),
    ).toBe(false);
  });

  it("reports a public-safe stop instruction after a partial failure", async () => {
    const { bundle, ...directories } = loadSyntheticBundle();
    const privateProviderMessage = "private source heading and value";
    const runner: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--file")) {
        throw new Error(privateProviderMessage);
      }
      return summary();
    };

    let caught: unknown;
    try {
      await executeImportBundle(
        bundle,
        productionOptions(directories),
        runner,
        vi.fn(),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportOperatorError);
    expect(String(caught)).toContain(
      "do not rerun against this target without a reviewed pre-release reset",
    );
    expect(String(caught)).not.toContain(privateProviderMessage);
  });
});
