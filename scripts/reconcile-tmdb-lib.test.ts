import { describe, expect, it, vi } from "vitest";
import type { GeneralizedImportDocument } from "./import-sheet-lib";
import {
  parseTmdbFindResponse,
  reconcileTmdb,
  type TmdbFindMovie,
} from "./reconcile-tmdb-lib";

const movie = (
  overrides: Partial<GeneralizedImportDocument["rows"][number]> = {},
): GeneralizedImportDocument["rows"][number] => ({
  franchiseIndicated: false,
  franchiseName: null,
  legacyImdbId: "tt1234567",
  priorViewed: false,
  rating: null,
  sourceRow: 2,
  submittedAt: "2026-08-01T10:30:00.000Z",
  title: "Synthetic Movie",
  ...overrides,
});

const document = (
  rows: GeneralizedImportDocument["rows"],
): GeneralizedImportDocument => ({
  nowShowingSourceRow: null,
  rows,
  schemaVersion: 2,
  validated: true,
});

const match = (overrides: Partial<TmdbFindMovie> = {}): TmdbFindMovie => ({
  id: 42,
  posterPath: "/synthetic.jpg",
  releaseDate: "2024-01-02",
  title: "Synthetic Movie",
  ...overrides,
});

const generatedAt = "2026-08-10T10:00:00.000Z";

describe("TMDB import reconciliation", () => {
  it("accepts only a sanitized TMDB find response", () => {
    expect(
      parseTmdbFindResponse({
        movie_results: [
          {
            id: 42,
            overview: "Provider text that must not be retained",
            poster_path: "/synthetic.jpg",
            release_date: "2024-01-02",
            title: "Synthetic Movie",
          },
        ],
      }),
    ).toEqual([match()]);
    expect(parseTmdbFindResponse({ movie_results: [{ id: "42" }] })).toBeNull();
  });

  it("confirms one exact normalized title match", async () => {
    const find = vi.fn().mockResolvedValue([match()]);
    const result = await reconcileTmdb(document([movie()]), find, generatedAt);

    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith("tt1234567");
    expect(result.diagnostics).toEqual([]);
    expect(result.document).toEqual({
      complete: true,
      generatedAt,
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
    });
  });

  it("does not link a provider result whose title conflicts", async () => {
    const result = await reconcileTmdb(
      document([movie()]),
      vi.fn().mockResolvedValue([match({ title: "Different Movie" })]),
      generatedAt,
    );

    expect(result.document.matches).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "TITLE_CONFLICT", sourceRows: [2] },
    ]);
  });

  it("does not call the provider for one external ID assigned to distinct submissions", async () => {
    const find = vi.fn();
    const result = await reconcileTmdb(
      document([
        movie(),
        movie({
          franchiseIndicated: true,
          franchiseName: "Distinct Saga",
          sourceRow: 3,
          title: "Distinct Movie",
        }),
      ]),
      find,
      generatedAt,
    );

    expect(find).not.toHaveBeenCalled();
    expect(result.document.matches).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "DUPLICATE_EXTERNAL_ID", sourceRows: [2, 3] },
    ]);
  });

  it("looks up repeated identical submissions only once", async () => {
    const find = vi.fn().mockResolvedValue([match()]);
    await reconcileTmdb(
      document([movie(), movie({ sourceRow: 3 })]),
      find,
      generatedAt,
    );

    expect(find).toHaveBeenCalledOnce();
  });

  it("stops after a provider failure and marks the document incomplete", async () => {
    const find = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const result = await reconcileTmdb(
      document([movie(), movie({ legacyImdbId: "tt7654321", sourceRow: 3 })]),
      find,
      generatedAt,
    );

    expect(find).toHaveBeenCalledOnce();
    expect(result.document.complete).toBe(false);
    expect(result.diagnostics).toEqual([
      { code: "LOOKUP_FAILED", sourceRows: [2] },
    ]);
  });

  it("rejects two legacy IDs that resolve to one TMDB identity", async () => {
    const result = await reconcileTmdb(
      document([
        movie(),
        movie({
          legacyImdbId: "tt7654321",
          sourceRow: 3,
          title: "Other Synthetic Movie",
        }),
      ]),
      vi
        .fn()
        .mockResolvedValueOnce([match()])
        .mockResolvedValueOnce([match({ title: "Other Synthetic Movie" })]),
      generatedAt,
    );

    expect(result.document.matches).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "DUPLICATE_TMDB_ID", sourceRows: [2] },
      { code: "DUPLICATE_TMDB_ID", sourceRows: [3] },
    ]);
  });
});
