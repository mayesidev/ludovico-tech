import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import {
  POSTER_REEL_IMAGE_WIDTH,
  preloadPosterPath,
  preloadPosterReel,
  posterReelDurationMs,
  selectPosterReel,
} from "./poster-reel";

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("random poster reel", () => {
  it("gives every prepared title one complete display interval", () => {
    expect(posterReelDurationMs(12)).toBe(2160);
    expect(posterReelDurationMs(3)).toBe(540);
  });

  it("shuffles unique local titles regardless of poster availability", () => {
    const reel = selectPosterReel(
      [
        movie("one", "/one.jpg"),
        movie("two", "/two.jpg"),
        movie("missing", null),
      ],
      () => 0,
    );

    expect(reel.map((entry) => entry.id)).toEqual(["two", "missing", "one"]);
    expect(new Set(reel.map((entry) => entry.id)).size).toBe(reel.length);
  });

  it("can still animate with poster fallbacks when metadata is absent", () => {
    expect(selectPosterReel([movie("missing", null)])).toEqual([
      movie("missing", null),
    ]);
  });

  it("decodes only the bounded reel at its rendered image size", async () => {
    const load = vi.fn().mockResolvedValue(true);
    const reel = selectPosterReel(
      Array.from({ length: 20 }, (_, index) =>
        movie(String(index), `/${index}.jpg`),
      ),
      () => 0,
    );

    await expect(preloadPosterReel(reel, load)).resolves.toEqual(reel);
    expect(load).toHaveBeenCalledTimes(12);
    expect(load).toHaveBeenCalledWith(
      `https://image.tmdb.org/t/p/w${POSTER_REEL_IMAGE_WIDTH}/1.jpg`,
    );
  });

  it("turns failed and missing poster loads into intentional fallbacks", async () => {
    const load = vi.fn().mockResolvedValue(false);

    await expect(
      preloadPosterReel(
        [movie("failed", "/failed.jpg"), movie("missing", null)],
        load,
      ),
    ).resolves.toEqual([movie("failed", null), movie("missing", null)]);
    expect(load).toHaveBeenCalledOnce();
    await expect(preloadPosterPath(null, load)).resolves.toBeNull();
  });

  it("uses the browser image decoder before making a poster eligible", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = decode;
      },
    );

    await expect(preloadPosterPath("/decoded.jpg")).resolves.toBe(
      "/decoded.jpg",
    );
    expect(decode).toHaveBeenCalledOnce();
  });

  it("stops waiting for a stalled image and uses the fallback", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = () => new Promise<void>(() => undefined);
      },
    );

    const posterPath = preloadPosterPath("/stalled.jpg");
    await vi.runAllTimersAsync();

    await expect(posterPath).resolves.toBeNull();
  });
});
