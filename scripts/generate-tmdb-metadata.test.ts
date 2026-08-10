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
      nowShowingSourceRow: null,
      rows: [
        {
          franchiseIndicated: false,
          franchiseName: null,
          legacyImdbId: "tt1234567",
          priorViewed: false,
          rating: null,
          sourceRow: 2,
          submittedAt: "2026-08-01T10:30:00.000Z",
          title: "Synthetic Movie",
        },
      ],
      schemaVersion: 2,
      validated: true,
    };
    const reconciliation: TmdbReconciliationDocument = {
      complete: true,
      generatedAt: "2026-08-10T10:00:00.000Z",
      matches: [
        {
          legacyImdbId: "tt1234567",
          posterPath: "/synthetic.jpg",
          providerTitleNormalized: "synthetic movie",
          releaseDate: "2024-01-02",
          sourceTitleNormalized: "synthetic movie",
          tmdbId: 42,
        },
      ],
      schemaVersion: 1,
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
        artifactType: "tmdb_metadata",
        chunks: ["chunk-0001.sql"],
        counts: { franchises: 0, movies: 1, ratings: 0, sources: 0 },
      });
      expect(sql).toContain("UPDATE movies SET release_date");
      expect(sql).not.toMatch(/INSERT|DELETE/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
