import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneralizedImportDocument } from "./import-sheet-lib";

const source: GeneralizedImportDocument = {
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

const originalArguments = process.argv;
const originalExitCode = process.exitCode;
const originalToken = process.env.TMDB_READ_ACCESS_TOKEN;

afterEach(() => {
  process.argv = originalArguments;
  process.exitCode = originalExitCode;
  if (originalToken === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
  else process.env.TMDB_READ_ACCESS_TOKEN = originalToken;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TMDB reconciliation command", () => {
  it("writes private artifacts and reuses its cache without another request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ludovico-reconcile-"));
    const input = join(directory, "input.json");
    const output = join(directory, "output.json");
    const report = join(directory, "report.json");
    const cache = join(directory, "cache.json");
    writeFileSync(input, JSON.stringify(source));
    process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
    process.argv = ["node", "reconcile-tmdb", input, output, report, cache];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            movie_results: [
              {
                id: 42,
                poster_path: "/synthetic.jpg",
                release_date: "2024-01-02",
                title: "Synthetic Movie",
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            belongs_to_collection: {
              id: 7,
              name: "Synthetic Collection",
            },
            credits: {
              cast: [{ id: 101, name: "Synthetic Actor", order: 0 }],
              crew: [{ id: 201, job: "Director", name: "Synthetic Director" }],
            },
            id: 42,
            runtime: 123,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await import("./reconcile-tmdb");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          host: "api.themoviedb.org",
          pathname: "/3/find/tt1234567",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          host: "api.themoviedb.org",
          pathname: "/3/movie/42",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(
        JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>,
      ).toMatchObject({
        complete: true,
        matches: [
          {
            runtimeMinutes: 123,
            tmdbCollectionId: 7,
            tmdbCollectionName: "Synthetic Collection",
          },
        ],
        schemaVersion: 4,
      });
      expect(
        JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown>,
      ).toMatchObject({
        complete: true,
        counts: {
          confirmed: 1,
          diagnostics: 0,
          uncachedFindLookups: 1,
          uncachedMovieLookups: 1,
        },
      });
      expect(statSync(cache).mode & 0o777).toBe(0o600);
      expect(statSync(output).mode & 0o777).toBe(0o600);
      expect(statSync(report).mode & 0o777).toBe(0o600);

      vi.resetModules();
      fetchMock.mockClear();
      await import("./reconcile-tmdb");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown>,
      ).toMatchObject({
        counts: { uncachedFindLookups: 0, uncachedMovieLookups: 0 },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("migrates the existing detail cache and requests only collection-aware details", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ludovico-reconcile-v2-"));
    const input = join(directory, "input.json");
    const output = join(directory, "output.json");
    const report = join(directory, "report.json");
    const cache = join(directory, "cache.json");
    writeFileSync(input, JSON.stringify(source));
    writeFileSync(
      cache,
      JSON.stringify({
        findEntries: {
          tt1234567: [
            {
              id: 42,
              posterPath: "/synthetic.jpg",
              releaseDate: "2024-01-02",
              title: "Synthetic Movie",
            },
          ],
        },
        movieEntries: { "42": { id: 42, runtimeMinutes: 123 } },
        schemaVersion: 2,
      }),
    );
    process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
    process.argv = ["node", "reconcile-tmdb", input, output, report, cache];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          belongs_to_collection: null,
          credits: { cast: [], crew: [] },
          id: 42,
          runtime: 123,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      vi.resetModules();
      await import("./reconcile-tmdb");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/3/movie/42" }),
        expect.any(Object),
      );
      expect(
        JSON.parse(readFileSync(cache, "utf8")) as Record<string, unknown>,
      ).toMatchObject({
        findEntries: { tt1234567: [expect.objectContaining({ id: 42 })] },
        movieEntries: {
          "42": { collection: null, id: 42, runtimeMinutes: 123 },
        },
        schemaVersion: 4,
      });
      expect(
        JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown>,
      ).toMatchObject({
        counts: { uncachedFindLookups: 0, uncachedMovieLookups: 1 },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
