import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeneralizedImportDocument,
  TmdbReconciliationDocument,
} from "./import-sheet-lib";

const originalArguments = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArguments;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("TMDB metadata artifact command", () => {
  it("writes a labeled update-only artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ludovico-metadata-"));
    const input = join(directory, "input.json");
    const reconciliationPath = join(directory, "reconciliation.json");
    const output = join(directory, "output");
    const document: GeneralizedImportDocument = {
      collectionOrders: [],
      nowShowingSourceRow: null,
      rows: [
        {
          collectionIndicated: false,
          collectionName: null,
          legacyImdbId: "tt1234567",
          priorViewed: false,
          rating: null,
          sourceRow: 2,
          submittedAt: "2026-08-01T10:30:00.000Z",
          title: "Synthetic Movie",
        },
      ],
      schemaVersion: 3,
      validated: true,
    };
    const reconciliation: TmdbReconciliationDocument = {
      complete: true,
      generatedAt: "2026-08-10T10:00:00.000Z",
      matches: [
        {
          cast: [{ id: 101, name: "Synthetic Actor" }],
          directors: [{ id: 201, name: "Synthetic Director" }],
          legacyImdbId: "tt1234567",
          posterPath: "/synthetic.jpg",
          providerTitleNormalized: "synthetic movie",
          releaseDate: "2024-01-02",
          runtimeMinutes: 123,
          sourceTitleNormalized: "synthetic movie",
          tmdbCollectionId: 7,
          tmdbCollectionName: "Synthetic Collection",
          tmdbId: 42,
        },
      ],
      schemaVersion: 4,
    };
    writeFileSync(input, JSON.stringify(document));
    writeFileSync(reconciliationPath, JSON.stringify(reconciliation));
    process.argv = [
      "node",
      "generate-tmdb-metadata",
      input,
      reconciliationPath,
      output,
      "2026-08-10T11:00:00.000Z",
    ];
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await import("./generate-tmdb-metadata");
      const manifest = JSON.parse(
        readFileSync(join(output, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      const sql = readFileSync(join(output, "chunk-0001.sql"), "utf8");

      expect(manifest).toMatchObject({
        artifactSchemaVersion: 2,
        artifactType: "tmdb_metadata",
        chunks: [
          {
            filename: "chunk-0001.sql",
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        ],
        counts: { collections: 0, movies: 1, ratings: 0, sources: 0 },
        nowShowingStatus: null,
      });
      expect(sql).toContain("INSERT INTO movie_tmdb_data");
      expect(sql).toContain("runtime_minutes, tmdb_collection_id");
      expect(sql).toContain("VALUES (7, 'Synthetic Collection'");
      expect(sql).toContain("INSERT INTO tmdb_people");
      expect(sql).toContain("INSERT OR REPLACE INTO movie_credits");
      expect(sql).not.toContain("UPDATE movies SET release_date");
      expect(sql).not.toMatch(/collection_movies|now_showing|ratings/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
