import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type CatalogImportPlan } from "./catalog-import-lib";
import {
  executeCatalogImport,
  importPreflightSummary,
  ImportOperatorError,
  parseImportOperatorArguments,
  type CommandRunner,
  type ImportOperatorOptions,
} from "./import-operator-lib";

const createPlan = (
  nowShowing: CatalogImportPlan["nowShowing"] = null,
): CatalogImportPlan => ({
  counts: {
    collectionMemberships: 2,
    collections: 1,
    movies: 2,
    ratings: 1,
    tmdbLinks: 1,
  },
  nowShowing,
  statements: ["SELECT 'private import data';"],
});

const productionOptions = (): ImportOperatorOptions => ({
  csvPath: "data/catalog.csv",
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
      now_showing_collection_id: null,
      now_showing_movie_id: null,
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

describe("catalog import input and target confirmation", () => {
  it("reports durable counts without private values", () => {
    expect(importPreflightSummary(createPlan())).toBe(
      "Preflight passed: 2 movies, 1 collection, 2 collection memberships, 1 rating, 1 TMDB link, Now Showing empty",
    );
    expect(
      importPreflightSummary(
        createPlan({ collectionId: null, movieId: "movie-2" }),
      ),
    ).toContain("Now Showing selected");
  });

  it("requires the configured database and complete import inputs", () => {
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "production",
        "--database",
        "ludovico-tech-staging",
        "--csv",
        "data/catalog.csv",
      ]),
    ).toThrow("Database confirmation must be ludovico-tech-production");
    expect(() =>
      parseImportOperatorArguments([
        "--environment",
        "unknown",
        "--database",
        "ludovico-tech-unknown",
        "--csv",
        "data/catalog.csv",
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
        "--csv",
        "data/catalog.csv",
        "--execute",
      ]),
    ).toThrow("Development execution requires an isolated --persist-to");
  });
});

describe("catalog import execution", () => {
  it("checks the target, applies temporary SQL, and verifies durable state", async () => {
    const calls: Array<{ arguments_: string[]; executable: string }> = [];
    const temporaryPaths: string[] = [];
    let summaryCall = 0;
    const runner: CommandRunner = async (executable, arguments_) => {
      calls.push({ arguments_, executable });
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--file")) {
        const path = arguments_.at(-1) as string;
        temporaryPaths.push(path);
        expect(basename(path)).toBe("chunk-0001.sql");
        expect(readFileSync(path, "utf8")).toContain("private import data");
        return "[]";
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

    await executeCatalogImport(createPlan(), productionOptions(), runner, log);

    expect(calls[0]).toEqual({
      arguments_: ["config:check"],
      executable: "pnpm",
    });
    expect(temporaryPaths).toHaveLength(1);
    expect(temporaryPaths.every((path) => !existsSync(path))).toBe(true);
    expect(log).toHaveBeenLastCalledWith(
      "Verified 2 movies, 1 collection, 2 collection memberships, 1 rating, and 1 TMDB link",
    );
  });

  it("verifies the exact selected Now Showing state", async () => {
    const plan = createPlan({
      collectionId: "collection-1",
      movieId: "movie-2",
    });
    let summaryCall = 0;
    const runner: CommandRunner = async (_executable, arguments_) => {
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
              now_showing_collection_id: "collection-1",
              now_showing_movie_id: "movie-2",
              now_showing_status: "ready",
              ratings: 1,
              tmdb_links: 1,
            });
      }
      return "[]";
    };

    await executeCatalogImport(plan, productionOptions(), runner, vi.fn());
  });

  it("does not contact the database without --execute", async () => {
    const options = { ...productionOptions(), execute: false };
    const runner = vi.fn<CommandRunner>();
    await executeCatalogImport(createPlan(), options, runner, vi.fn());
    expect(runner).not.toHaveBeenCalled();
  });

  it("stops before writes when migrations or empty-target checks fail", async () => {
    const missingMigration: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return d1Response([]);
      }
      return summary();
    };
    await expect(
      executeCatalogImport(
        createPlan(),
        productionOptions(),
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
      executeCatalogImport(
        createPlan(),
        productionOptions(),
        occupied,
        vi.fn(),
      ),
    ).rejects.toThrow("not an empty migrated import target");
  });

  it("reports a stop condition after a write or postcheck failure", async () => {
    const failedChunk: CommandRunner = async (_executable, arguments_) => {
      if (arguments_.length === 1) return "";
      if (arguments_.includes("SELECT name FROM d1_migrations ORDER BY id")) {
        return migrationResponse();
      }
      if (arguments_.includes("--command")) return summary();
      throw new Error("private write failure");
    };
    await expect(
      executeCatalogImport(
        createPlan(),
        productionOptions(),
        failedChunk,
        vi.fn(),
      ),
    ).rejects.toThrow("do not rerun against this target");

    let summaryCall = 0;
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
      executeCatalogImport(
        createPlan(),
        productionOptions(),
        failedPostcheck,
        vi.fn(),
      ),
    ).rejects.toThrow("Post-import database verification failed; do not rerun");
  });

  it("does not expose command failure details", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("private command detail");
    };
    await expect(
      executeCatalogImport(createPlan(), productionOptions(), runner, vi.fn()),
    ).rejects.toEqual(
      new ImportOperatorError("Target configuration validation failed"),
    );
  });
});
