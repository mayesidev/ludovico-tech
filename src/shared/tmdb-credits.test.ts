import { describe, expect, it } from "vitest";
import { parseTmdbCredits } from "./tmdb-credits";

describe("TMDB credits", () => {
  it("keeps five distinct cast members in billing order and three directors", () => {
    expect(
      parseTmdbCredits({
        cast: [
          { id: 4, name: "Fourth Actor", order: 3 },
          { id: 1, name: " First Actor ", order: 0 },
          { id: 2, name: "Second Actor", order: 1 },
          { id: 2, name: "Duplicate Actor", order: 2 },
          { id: 3, name: "Third Actor", order: 2 },
          { id: 5, name: "Fifth Actor", order: 4 },
          { id: 6, name: "Sixth Actor", order: 5 },
        ],
        crew: [
          { id: 21, job: "Director", name: "First Director" },
          { id: 22, job: "Director", name: "Second Director" },
          { id: 21, job: "Director", name: "Duplicate Director" },
          { id: 23, job: "Director", name: "Third Director" },
          { id: 24, job: "Director", name: "Fourth Director" },
          { id: 25, job: "Producer", name: "Not a Director" },
        ],
      }),
    ).toEqual({
      cast: [
        { id: 1, name: "First Actor" },
        { id: 2, name: "Second Actor" },
        { id: 3, name: "Third Actor" },
        { id: 4, name: "Fourth Actor" },
        { id: 5, name: "Fifth Actor" },
      ],
      directors: [
        { id: 21, name: "First Director" },
        { id: 22, name: "Second Director" },
        { id: 23, name: "Third Director" },
      ],
    });
  });

  it("requires both provider credit arrays and ignores invalid people", () => {
    expect(parseTmdbCredits({ cast: [] })).toBeNull();
    expect(parseTmdbCredits({ crew: [] })).toBeNull();
    expect(
      parseTmdbCredits({
        cast: [
          { id: -1, name: "Invalid ID", order: 0 },
          { id: 1, name: "", order: 1 },
          { id: 2, name: "No billing order" },
        ],
        crew: [
          { id: 3, job: "director", name: "Wrong job casing" },
          { id: 4, job: "Director", name: "" },
        ],
      }),
    ).toEqual({ cast: [], directors: [] });
  });
});
