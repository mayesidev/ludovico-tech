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
  });

  it("rejects unknown and malformed routes", () => {
    expect(parseRoute("/unknown")).toEqual({ page: "not-found" });
    expect(parseRoute("/movies/%E0%A4%A")).toEqual({ page: "not-found" });
  });
});
