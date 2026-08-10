import { describe, expect, it } from "vitest";
import { formatDate, formatRuntime, posterUrl } from "./utils";

describe("movie display helpers", () => {
  it("builds a TMDB poster URL from a path", () => {
    expect(posterUrl("/poster.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/poster.jpg",
    );
  });

  it("handles missing poster paths", () => {
    expect(posterUrl(null)).toBeNull();
  });

  it("formats ISO dates for the UI", () => {
    expect(formatDate("2020-01-02")).toBe("Jan 2, 2020");
  });

  it("formats runtimes without empty units", () => {
    expect(formatRuntime(45)).toBe("45m");
    expect(formatRuntime(120)).toBe("2h");
    expect(formatRuntime(136)).toBe("2h 16m");
  });
});
