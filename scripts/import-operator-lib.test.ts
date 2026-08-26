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

const createArtifact = () => {
  const directory = temporaryDirectory();
  writeImportArtifacts(
    directory,
    [
      { filename: "chunk-0001.sql", sql: "SELECT 'catalog one';\n" },
      { filename: "chunk-0002.sql", sql: "SELECT 'catalog two';\n" },
    ],
    {
      collectionMemberships: 2,
      collections: 1,
      movies: 2,
      ratings: 1,
      tmdbLinks: 1,
    },
    "2026-08-25T12:00:00.000Z",
    [],
  );
  return directory;
};

const productionOptions = (
  catalogDirectory: string,
): ImportOperatorOptions => ({
  catalogDirectory,
  database: "ludovico-tech-production",
  environment: "production",
  execute: true,
  persistTo: null,
});

const d1Response = (results: Array<Record<string, unknown>>) =>
  JSON.stringify([{ results, success: true }]);

const summary = (overrides: Record<string, unknown> = {}) =>
  d1Response([
    {
      collection_memberships: 0,
      collections: 0,
      movies: 0,
      now_showing_status: "empty",
      ratings: 0,
      tmdb_links: 0,
      ...overrides,
    },
  ]);

const migrationResponse = () =>
  d1Response(
    readdirSync("migrations")
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .map((name) => ({ name })),
  );

describe("catalog import artifact preflight", () => {
  it("loads only a complete ordered checksummed artifact", () => {
    const bundle = loadImportBundle(createArtifact());
    expect(bundle.catalog.chunks.map((chunk) => chunk.filename)).toEqual([
      "chunk-0001.sql",
      "chunk-0002.sql",
    ]);
    expect(importPreflightSummary(bundle)).toBe(
      "Preflight passed: 2 catalog chunks, 2 movies, 1 collection, 2 collection memberships, 1 rating, 1 TMDB link",
    );
  });

  it("rejects changed, missing, or out-of-order chunks", () => {
    const changed = createArtifact();
    writeFileSync(join(changed, "chunk-0001.sql"), "SELECT 'changed';\n");
    expect(() => loadImportBundle(changed)).toThrow(
      "catalog_import chunk chunk-0001.sql failed its checksum",
    );

    const missing = createArtifact();
    rmSync(join(missing, "chunk-0002.sql"));
    expect(() => loadImportBundle(missing)).toThrow(
      "catalog_import chunks do not match the manifest",
    );

    const reordered = createArtifact();
    const manifestPath = join(reordered, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      chunks: unknown[];
    };
    manifest.chunks.reverse();
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => loadImportBundle(reordered)).toThrow(
      "catalog_import chunk sequence is not contiguous",
    );
  });

  it("rejects obsolete artifact and provider-metadata contracts", () => {
    for (const mutation of [
      (manifest: Record<string, unknown>) => {
        manifest.artifactSchemaVersion = 2;
      },
      (manifest: Record<string, unknown>) => {
        manifest.artifactType = "tmdb_metadata";
      },
      (manifest: Record<string, unknown>) => {
        manifest.nowShowingStatus = "ready";
      },
    ]) {
      const directory = createArtifact();
      const path = join(directory, "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
      >;
      mutation(manifest);
      writeFileSync(path, JSON.stringify(manifest));
      expect(() => loadImportBundle(directory)).toThrow(
        "catalog_import manifest is invalid",
      );
    }
  });

  it("rejects failed validation and inconsistent durable counts", () => {
    const invalidReport = createArtifact();
    writeFileSync(
      join(invalidReport, "validation-report.json"),
      JSON.stringify({
        diagnostics: [{ code: "INVALID_TITLE", row: 2, severity: "error" }],
        schemaVersion: 1,
        valid: false,
      }),
    );
    expect(() => loadImportBundle(invalidReport)).toThrow(
      "catalog_import validation report is invalid or failed",
    );

    const invalidCounts = createArtifact();
    const path = join(invalidCounts, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      counts: { tmdbLinks: number };
    };
    manifest.counts.tmdbLinks = 3;
    writeFileSync(path, JSON.stringify(manifest));
    expect(() => loadImportBundle(invalidCounts)).toThrow(
      "Import artifact counts are inconsistent",
    );
  });
});

describe("catalog import target confirmation", () => {
  it("requires an exact known environment and database pair", () => {
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "production",
        "--database",
        "ludovico-tech-staging",
        "--catalog",
        "artifact",
      ]),
    ).toThrow("Database confirmation must be ludovico-tech-production");
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "unknown",
        "--database",
        "ludovico-tech-unknown",
        "--catalog",
        "artifact",
      ]),
    ).toThrow("Environment unknown is not configured for catalog imports");
  });

  it("requires isolated persistence for local execution", () => {
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "development",
        "--database",
        "ludovico-tech-development",
        "--catalog",
        "artifact",
        "--execute",
      ]),
    ).toThrow("Development execution requires an isolated --persist-to");
  });

  it("rejects removed metadata and unknown options", () => {
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "production",
        "--database",
        "ludovico-tech-production",
        "--catalog",
        "artifact",
        "--metadata",
        "provider-artifact",
      ]),
    ).toThrow("Unknown or repeated option --metadata");
  });
});

describe("catalog import execution", () => {
  it("verifies migrations and emptiness before applying and verifies every durable count", async () => {
    const directory = createArtifact();
    const bundle = loadImportBundle(directory);
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
              collection_memberships: 2,
              collections: 1,
              movies: 2,
              ratings: 1,
              tmdb_links: 1,
            });
      }
      return "[]";
    };
    const log = vi.fn();

    await executeImportBundle(
      bundle,
      productionOptions(directory),
      runner,
      log,
    );

    expect(calls[0]).toEqual({
      arguments_: ["config:check"],
      executable: "pnpm",
    });
    expect(
      calls.filter((call) => call.arguments_.includes("--file")),
    ).toHaveLength(2);
    expect(
      calls
        .filter((call) => call.arguments_.includes("--file"))
        .map((call) => basename(call.arguments_.at(-1) as string)),
    ).toEqual(["chunk-0001.sql", "chunk-0002.sql"]);
    expect(log).toHaveBeenLastCalledWith(
      "Verified 2 movies, 1 collection, 2 collection memberships, 1 rating, and 1 TMDB link",
    );
  });

  it("does not contact the database during preflight", async () => {
    const directory = createArtifact();
    const options = { ...productionOptions(directory), execute: false };
    const runner = vi.fn<CommandRunner>();
    await executeImportBundle(
      loadImportBundle(directory),
      options,
      runner,
      vi.fn(),
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("stops before writes when migrations or empty-target checks fail", async () => {
    const directory = createArtifact();
    const bundle = loadImportBundle(directory);
    const missingMigration: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return d1Response([]);
      }
      return summary();
    };
    await expect(
      executeImportBundle(
        bundle,
        productionOptions(directory),
        missingMigration,
        vi.fn(),
      ),
    ).rejects.toThrow("Migration verification failed");

    const occupied: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      return summary({ movies: 1 });
    };
    await expect(
      executeImportBundle(
        bundle,
        productionOptions(directory),
        occupied,
        vi.fn(),
      ),
    ).rejects.toThrow("not an empty migrated import target");
  });

  it("reports a stop condition after a write or postcheck failure", async () => {
    const directory = createArtifact();
    const bundle = loadImportBundle(directory);
    let summaryCall = 0;
    const failedChunk: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--command")) return summary();
      throw new Error("write failed");
    };
    await expect(
      executeImportBundle(
        bundle,
        productionOptions(directory),
        failedChunk,
        vi.fn(),
      ),
    ).rejects.toThrow("do not rerun against this target");

    const failedPostcheck: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--command")) {
        summaryCall += 1;
        return summaryCall === 1 ? summary() : summary({ movies: 2 });
      }
      return "[]";
    };
    await expect(
      executeImportBundle(
        bundle,
        productionOptions(directory),
        failedPostcheck,
        vi.fn(),
      ),
    ).rejects.toThrow("Post-import database verification failed; do not rerun");
  });

  it("maps command failures to public-safe operator errors", async () => {
    const directory = createArtifact();
    const runner: CommandRunner = async () => {
      throw new Error("private command detail");
    };
    await expect(
      executeImportBundle(
        loadImportBundle(directory),
        productionOptions(directory),
        runner,
        vi.fn(),
      ),
    ).rejects.toEqual(
      new ImportOperatorError("Target configuration validation failed"),
    );
  });
});
