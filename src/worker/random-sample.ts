type RandomIndex = (upperBound: number) => number;

const secureRandomIndex: RandomIndex = (upperBound) => {
  const range = 0x1_0000_0000;
  const unbiasedLimit = range - (range % upperBound);
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  } while (value >= unbiasedLimit);
  return value % upperBound;
};

export const createRandomIndexSampler = (
  populationSize: number,
  randomIndex: RandomIndex = secureRandomIndex,
) => {
  const swaps = new Map<number, number>();
  let remaining = populationSize;

  return () => {
    if (remaining === 0) return null;
    const pickedOffset = randomIndex(remaining);
    const selectedOffset = swaps.get(pickedOffset) ?? pickedOffset;
    const lastOffset = swaps.get(remaining - 1) ?? remaining - 1;
    swaps.set(pickedOffset, lastOffset);
    swaps.delete(remaining - 1);
    remaining -= 1;
    return selectedOffset;
  };
};
