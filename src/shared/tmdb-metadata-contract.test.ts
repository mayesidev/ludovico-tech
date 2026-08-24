import { describe, expect, it } from "vitest";
import {
  fingerprintTmdbMetadataContract,
  getTmdbMetadataContractId,
  TMDB_METADATA_CONTRACT,
  TMDB_REQUEST_OPTIONS,
  tmdbMovieDetailSchema,
} from "./tmdb-metadata-contract";

const movie = {
  cast: [{ id: 10, name: "Lead Actor" }],
  collection: { id: 20, name: "Movie Series" },
  directors: [{ id: 30, name: "Director" }],
  id: 40,
  posterPath: "/poster.jpg",
  releaseDate: "2026-08-24",
  runtimeMinutes: 120,
  title: "Movie Title",
};

describe("TMDB metadata contract", () => {
  it("validates the exact normalized payload persisted by the application", () => {
    expect(tmdbMovieDetailSchema.parse(movie)).toEqual(movie);
    expect(
      tmdbMovieDetailSchema.safeParse({ ...movie, unexpected: true }).success,
    ).toBe(false);
    expect(
      tmdbMovieDetailSchema.safeParse({
        ...movie,
        cast: Array.from({ length: 6 }, (_, index) => ({
          id: index + 1,
          name: `Actor ${index + 1}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      tmdbMovieDetailSchema.safeParse({
        ...movie,
        directors: [
          { id: 30, name: "Director" },
          { id: 30, name: "Director" },
        ],
      }).success,
    ).toBe(false);
  });

  it("derives a stable SHA-256 identity independent of object key order", async () => {
    await expect(getTmdbMetadataContractId()).resolves.toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    const [left, right] = await Promise.all([
      fingerprintTmdbMetadataContract({ second: 2, first: 1 }),
      fingerprintTmdbMetadataContract({ first: 1, second: 2 }),
    ]);
    expect(left).toBe(right);
  });

  it("changes identity when the fetched-and-stored contract changes", async () => {
    const changedContract: unknown = structuredClone(TMDB_METADATA_CONTRACT);
    (
      changedContract as {
        normalization: { people: { cast: { limit: number } } };
      }
    ).normalization.people.cast.limit = 4;

    await expect(
      fingerprintTmdbMetadataContract(changedContract),
    ).resolves.not.toBe(await getTmdbMetadataContractId());
  });

  it("keeps request mechanics outside the metadata contract", async () => {
    expect(TMDB_METADATA_CONTRACT).not.toHaveProperty("request");
    expect(TMDB_METADATA_CONTRACT.normalization).not.toHaveProperty("request");
    expect(TMDB_REQUEST_OPTIONS).toEqual({
      appendToResponse: ["credits"],
      language: "en-US",
    });
    await expect(
      fingerprintTmdbMetadataContract(TMDB_METADATA_CONTRACT),
    ).resolves.toBe(await getTmdbMetadataContractId());
  });
});
