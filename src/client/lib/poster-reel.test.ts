import { describe, expect, it } from "vitest";
import type { Movie } from "../api";
import { selectPosterReel } from "./poster-reel";

const movie = (id: string, posterPath: string | null): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id,
  imdb_id: null,
  poster_path: posterPath,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: `Movie ${id}`,
  tmdb_id: null,
  watched_at: null,
});

describe("random poster reel", () => {
  it("shuffles unique local catalog posters without requesting provider data", () => {
    const reel = selectPosterReel(
      [
        movie("one", "/one.jpg"),
        movie("two", "/two.jpg"),
        movie("missing", null),
      ],
      () => 0,
    );

    expect(reel.map((entry) => entry.id)).toEqual(["two", "one"]);
    expect(new Set(reel.map((entry) => entry.id)).size).toBe(reel.length);
  });

  it("can still animate with poster fallbacks when metadata is absent", () => {
    expect(selectPosterReel([movie("missing", null)])).toEqual([
      movie("missing", null),
    ]);
  });
});
