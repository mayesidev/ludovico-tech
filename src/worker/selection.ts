type SelectableMovie = {
  collection_id: string | null;
  id: string;
};

export const selectQueuedMovie = <T extends SelectableMovie>(
  rolled: T,
  remainingCollectionMovies: T[],
) => (rolled.collection_id ? (remainingCollectionMovies[0] ?? rolled) : rolled);
