import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";

describe("client routes", () => {
  it("recognizes catalog pages and encoded movie IDs", () => {
    expect(parseRoute("/")).toEqual({ page: "home" });
    expect(parseRoute("/library")).toEqual({ page: "library" });
    expect(parseRoute("/movies/movie%20id")).toEqual({
      page: "movie",
      movieId: "movie id",
    });
    expect(parseRoute("/franchises/saga%20id")).toEqual({
      page: "franchise",
      franchiseId: "saga id",
      returnTo: "library",
    });
    expect(parseRoute("/franchises/saga%20id", "?from=now-showing")).toEqual({
      page: "franchise",
      franchiseId: "saga id",
      returnTo: "now-showing",
    });
  });

  it("rejects unknown and malformed routes", () => {
    expect(parseRoute("/unknown")).toEqual({ page: "not-found" });
    expect(parseRoute("/movies/%E0%A4%A")).toEqual({ page: "not-found" });
  });
});
