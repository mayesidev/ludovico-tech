import { describe, expect, it, vi } from "vitest";
import type { GeneralizedImportDocument } from "./import-sheet-lib";
import {
  parseTmdbFindResponse,
  parseTmdbMovieResponse,
  reconcileTmdb,
  type TmdbFindMovie,
} from "./reconcile-tmdb-lib";

const movie = (
  overrides: Partial<GeneralizedImportDocument["rows"][number]> = {},
): GeneralizedImportDocument["rows"][number] => ({
  collectionIndicated: false,
  collectionName: null,
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
  schemaVersion: 3,
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
const getMovie = () =>
  vi.fn().mockResolvedValue({
    collection: { id: 7, name: "Synthetic Collection" },
    id: 42,
    runtimeMinutes: 123,
  });

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
    expect(
      parseTmdbMovieResponse({
        belongs_to_collection: {
          id: 7,
          name: "Synthetic Collection",
          poster_path: "/ignored.jpg",
        },
        id: 42,
        runtime: 123,
      }),
    ).toEqual({
      collection: { id: 7, name: "Synthetic Collection" },
      id: 42,
      runtimeMinutes: 123,
    });
    expect(
      parseTmdbMovieResponse({
        belongs_to_collection: null,
        id: 42,
        runtime: 0,
      }),
    ).toEqual({
      collection: null,
      id: 42,
      runtimeMinutes: null,
    });
    expect(
      parseTmdbMovieResponse({
        belongs_to_collection: null,
        id: 42,
        runtime: "123",
      }),
    ).toBeNull();
  });

  it("confirms one exact normalized title match", async () => {
    const find = vi.fn().mockResolvedValue([match()]);
    const detail = getMovie();
    const result = await reconcileTmdb(
      document([movie()]),
      find,
      detail,
      generatedAt,
    );

    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith("tt1234567");
    expect(detail).toHaveBeenCalledWith(42);
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
          runtimeMinutes: 123,
          sourceTitleNormalized: "synthetic movie",
          tmdbCollectionId: 7,
          tmdbCollectionName: "Synthetic Collection",
          tmdbId: 42,
        },
      ],
      schemaVersion: 3,
    });
  });

  it("does not link a provider result whose title conflicts", async () => {
    const result = await reconcileTmdb(
      document([movie()]),
      vi.fn().mockResolvedValue([match({ title: "Different Movie" })]),
      getMovie(),
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
          collectionIndicated: true,
          collectionName: "Distinct Saga",
          sourceRow: 3,
          title: "Distinct Movie",
        }),
      ]),
      find,
      getMovie(),
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
      getMovie(),
      generatedAt,
    );

    expect(find).toHaveBeenCalledOnce();
  });

  it("stops after a provider failure and marks the document incomplete", async () => {
    const find = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const result = await reconcileTmdb(
      document([movie(), movie({ legacyImdbId: "tt7654321", sourceRow: 3 })]),
      find,
      getMovie(),
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
      getMovie(),
      generatedAt,
    );

    expect(result.document.matches).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "DUPLICATE_TMDB_ID", sourceRows: [2] },
      { code: "DUPLICATE_TMDB_ID", sourceRows: [3] },
    ]);
  });

  it("stops when authoritative movie details cannot be retrieved", async () => {
    const result = await reconcileTmdb(
      document([movie()]),
      vi.fn().mockResolvedValue([match()]),
      vi.fn().mockRejectedValue(new Error("provider unavailable")),
      generatedAt,
    );

    expect(result.document.complete).toBe(false);
    expect(result.document.matches).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "LOOKUP_FAILED", sourceRows: [2] },
    ]);
  });
});
