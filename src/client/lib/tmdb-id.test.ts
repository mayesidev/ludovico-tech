import { describe, expect, it } from "vitest";
import { parseTmdbId } from "./tmdb-id";

describe("TMDB ID parsing", () => {
  it("accepts positive safe integers and treats an empty value as no match", () => {
    expect(parseTmdbId(" 42 ")).toBe(42);
    expect(parseTmdbId("")).toBeNull();
  });

  it("rejects zero, decimals, and unsafe integers", () => {
    expect(parseTmdbId("0")).toBeUndefined();
    expect(parseTmdbId("1.5")).toBeUndefined();
    expect(parseTmdbId("9007199254740992")).toBeUndefined();
  });
});
