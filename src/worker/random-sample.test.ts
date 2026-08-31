import { describe, expect, it } from "vitest";
import { sampleOffsetsWithoutReplacement } from "./random-sample";

describe("random sampling without replacement", () => {
  it("draws independent unique offsets instead of an adjacent slice", () => {
    const values = [0, 3, 4];
    const randomIndex = (upperBound: number) => {
      const value = values.shift() ?? 0;
      expect(value).toBeLessThan(upperBound);
      return value;
    };

    expect(sampleOffsetsWithoutReplacement(8, 3, randomIndex)).toEqual([
      0, 3, 4,
    ]);
  });

  it("returns every available offset when the requested sample is larger", () => {
    expect(sampleOffsetsWithoutReplacement(2, 3, () => 0)).toEqual([0, 1]);
  });
});
