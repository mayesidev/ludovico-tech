import type { Movie } from "../api";

export const POSTER_REEL_DURATION_MS = 2400;
export const POSTER_REVEAL_DURATION_MS = 1200;
export const POSTER_REEL_INTERVAL_MS = 180;

export const selectPosterReel = (
  movies: Movie[],
  random: () => number = Math.random,
  limit = 12,
) => {
  const moviesWithPosters = movies.filter((movie) => movie.poster_path);
  const candidates = moviesWithPosters.length > 0 ? moviesWithPosters : movies;
  const shuffled = [...candidates];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled.slice(0, limit);
};

export const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));
