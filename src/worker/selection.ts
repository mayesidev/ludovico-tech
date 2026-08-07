type SelectableMovie = {
  franchise_id: string | null;
  id: string;
};

export const selectQueuedMovie = <T extends SelectableMovie>(
  rolled: T,
  orderConfirmed: boolean,
  remainingFranchiseMovies: T[],
) =>
  rolled.franchise_id && orderConfirmed
    ? (remainingFranchiseMovies[0] ?? rolled)
    : rolled;
