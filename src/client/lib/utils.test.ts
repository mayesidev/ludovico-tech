import { describe, expect, it } from "vitest";
import { formatDate, posterUrl } from "./utils";

describe("movie display helpers", () => {
  it("builds a TMDB poster URL from a path", () => {
    expect(posterUrl("/poster.jpg")).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
  });

  it("handles missing poster paths", () => {
    expect(posterUrl(null)).toBeNull();
  });

  it("formats ISO dates for the UI", () => {
    expect(formatDate("2020-01-02")).toBe("Jan 2, 2020");
  });
});
