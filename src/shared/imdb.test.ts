import { describe, expect, it } from "vitest";
import { imdbTitleUrl, parseImdbId } from "./imdb";

describe("IMDb references", () => {
  it("normalizes bare IDs and treats an empty value as no reference", () => {
    expect(parseImdbId(" TT0117509 ")).toBe("tt0117509");
    expect(parseImdbId(" ")).toBeNull();
  });

  it.each([
    "https://www.imdb.com/title/tt0117509/",
    "https://imdb.com/title/tt0117509",
    "https://m.imdb.com/title/tt0117509/?ref_=fn_all_ttl_1",
    "http://m.imdb.com/title/TT0117509#reviews",
  ])("extracts an ID from a supported title URL: %s", (value) => {
    expect(parseImdbId(value)).toBe("tt0117509");
  });

  it.each([
    "tt12345",
    "tt1234567890",
    "https://example.com/title/tt0117509/",
    "https://imdb.com/name/tt0117509/",
    "https://imdb.com/title/tt0117509/reviews",
    "https://imdb.com:8443/title/tt0117509/",
  ])("rejects an invalid IMDb reference: %s", (value) => {
    expect(parseImdbId(value)).toBeUndefined();
  });

  it("generates the canonical desktop title URL", () => {
    expect(imdbTitleUrl("tt0117509")).toBe(
      "https://www.imdb.com/title/tt0117509/",
    );
  });
});
