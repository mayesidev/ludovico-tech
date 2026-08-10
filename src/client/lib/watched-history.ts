import type { Movie } from "../api";

const HISTORY_SIZE = 4;

const shuffle = (movies: Movie[], random: () => number) => {
  for (let index = movies.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [movies[index], movies[swapIndex]] = [movies[swapIndex], movies[index]];
  }
  return movies;
};

export const selectWatchedHistory = (
  movies: Movie[],
  random: () => number = Math.random,
) => {
  const watched = movies.filter((movie) => movie.rating_score !== null);
  const latest = watched
    .filter((movie) => movie.watched_at !== null)
    .sort(
      (left, right) =>
        String(right.watched_at).localeCompare(String(left.watched_at)) ||
        left.id.localeCompare(right.id),
    )[0];
  const previous = shuffle(
    watched.filter((movie) => movie.id !== latest?.id),
    random,
  );

  return latest
    ? [latest, ...previous.slice(0, HISTORY_SIZE - 1)]
    : previous.slice(0, HISTORY_SIZE);
};
