import { describe, expect, it } from "vitest";
import type { Movie } from "../api";
import { selectWatchedHistory } from "./watched-history";

const movie = (
  id: string,
  watchedAt: string | null,
  ratingScore: number | null = 4,
): Movie => ({
  added_at: "2026-01-01T00:00:00.000Z",
  collection_id: null,
  id,
  poster_path: null,
  rating_phrase: ratingScore === null ? null : `${id} rating`,
  rating_score: ratingScore,
  release_date: null,
  runtime_minutes: null,
  title: id,
  tmdb_id: null,
  watched_at: watchedAt,
});

describe("watched history selection", () => {
  it("keeps the latest known rating first and samples earlier ratings", () => {
    const selected = selectWatchedHistory(
      [
        movie("unwatched", null, null),
        movie("older-one", "2026-08-01T00:00:00.000Z"),
        movie("latest", "2026-08-09T00:00:00.000Z"),
        movie("older-two", "2026-08-02T00:00:00.000Z"),
        movie("legacy-one", null),
        movie("legacy-two", null),
      ],
      () => 0,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      "latest",
      "older-two",
      "legacy-one",
      "legacy-two",
    ]);
    expect(new Set(selected.map(({ id }) => id)).size).toBe(4);
    expect(selected.map(({ id }) => id)).not.toContain("unwatched");
  });

  it("samples legacy ratings when no watch timestamp is known", () => {
    const selected = selectWatchedHistory(
      [
        movie("legacy-one", null),
        movie("legacy-two", null),
        movie("legacy-three", null),
        movie("legacy-four", null),
        movie("legacy-five", null),
      ],
      () => 0,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      "legacy-two",
      "legacy-three",
      "legacy-four",
      "legacy-five",
    ]);
  });

  it("returns every watched movie when fewer than four exist", () => {
    const selected = selectWatchedHistory(
      [movie("latest", "2026-08-09T00:00:00.000Z"), movie("legacy", null)],
      () => 0,
    );

    expect(selected.map(({ id }) => id)).toEqual(["latest", "legacy"]);
  });
});
