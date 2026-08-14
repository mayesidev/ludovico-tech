import { describe, expect, it } from "vitest";
import { parseVersionReferenceUrl, parseVersionRuntime } from "./movie-version";

describe("movie version parsing", () => {
  it("accepts optional positive whole-minute runtimes", () => {
    expect(parseVersionRuntime("")).toBeNull();
    expect(parseVersionRuntime(" 132 ")).toBe(132);
    expect(parseVersionRuntime("0")).toBeUndefined();
    expect(parseVersionRuntime("1.5")).toBeUndefined();
    expect(parseVersionRuntime("9007199254740992")).toBeUndefined();
  });

  it("accepts optional HTTP references", () => {
    expect(parseVersionReferenceUrl("")).toBeNull();
    expect(parseVersionReferenceUrl(" https://example.com/cut ")).toBe(
      "https://example.com/cut",
    );
    expect(parseVersionReferenceUrl("http://example.com/release")).toBe(
      "http://example.com/release",
    );
    expect(
      parseVersionReferenceUrl("file:///private/edit.mkv"),
    ).toBeUndefined();
    expect(parseVersionReferenceUrl("not a URL")).toBeUndefined();
  });
});
