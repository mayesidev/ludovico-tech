import { describe, expect, it } from "vitest";
import { createRandomIndexSampler } from "./random-sample";

describe("random sampling without replacement", () => {
  it("draws independent unique offsets instead of an adjacent slice", () => {
    const values = [0, 3, 4];
    const randomIndex = (upperBound: number) => {
      const value = values.shift() ?? 0;
      expect(value).toBeLessThan(upperBound);
      return value;
    };
    const sample = createRandomIndexSampler(8, randomIndex);

    expect([sample(), sample(), sample()]).toEqual([0, 3, 4]);
  });

  it("exhausts every available offset exactly once", () => {
    const sample = createRandomIndexSampler(2, () => 0);

    expect([sample(), sample(), sample()]).toEqual([0, 1, null]);
  });
});
