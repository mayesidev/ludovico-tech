type SelectableMovie = {
  collection_id: string | null;
  id: string;
};

export const selectQueuedMovie = <T extends SelectableMovie>(
  rolled: T,
  orderConfirmed: boolean,
  remainingCollectionMovies: T[],
) =>
  rolled.collection_id && orderConfirmed
    ? (remainingCollectionMovies[0] ?? rolled)
    : rolled;
