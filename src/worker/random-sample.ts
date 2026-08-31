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

export const sampleOffsetsWithoutReplacement = (
  populationSize: number,
  sampleSize: number,
  randomIndex: RandomIndex = secureRandomIndex,
) => {
  const selected: number[] = [];
  const swaps = new Map<number, number>();
  const size = Math.min(populationSize, sampleSize);

  for (let index = 0; index < size; index += 1) {
    const remaining = populationSize - index;
    const pickedOffset = randomIndex(remaining);
    const selectedOffset = swaps.get(pickedOffset) ?? pickedOffset;
    const lastOffset = swaps.get(remaining - 1) ?? remaining - 1;
    swaps.set(pickedOffset, lastOffset);
    swaps.delete(remaining - 1);
    selected.push(selectedOffset);
  }

  return selected;
};
