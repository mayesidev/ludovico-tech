import type { HomeMovie } from "../api";
import { posterUrl } from "./utils";

export const POSTER_REVEAL_DURATION_MS = 1200;
export const POSTER_REEL_INTERVAL_MS = 180;
export const POSTER_REEL_LEAD_IN_MS = POSTER_REEL_INTERVAL_MS;
export const POSTER_REEL_IMAGE_WIDTH = 342;
export const POSTER_REEL_LIMIT = 12;
const POSTER_LOAD_TIMEOUT_MS = 2000;

type PosterLoader = (url: string) => Promise<boolean>;

export const posterReelDurationMs = (titleCount: number) =>
  titleCount * POSTER_REEL_INTERVAL_MS;

export const selectPosterReel = (
  movies: HomeMovie[],
  random: () => number = Math.random,
  limit = POSTER_REEL_LIMIT,
) => {
  const shuffled = [...movies];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled.slice(0, limit);
};

const loadPosterImage: PosterLoader = async (url) => {
  const image = new Image();
  image.src = url;

  if (typeof image.decode !== "function") return false;

  let timeout: number | undefined;
  try {
    return await Promise.race([
      image.decode().then(() => true),
      new Promise<false>((resolve) => {
        timeout = window.setTimeout(
          () => resolve(false),
          POSTER_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

export const preloadPosterPath = async (
  path: string | null | undefined,
  load: PosterLoader = loadPosterImage,
): Promise<string | null> => {
  const url = posterUrl(path, POSTER_REEL_IMAGE_WIDTH);
  if (!url) return null;
  return (await load(url)) ? (path ?? null) : null;
};

export const preloadPosterReel = async (
  reel: HomeMovie[],
  load: PosterLoader = loadPosterImage,
) =>
  Promise.all(
    reel.map(async (movie) => {
      const posterPath = await preloadPosterPath(movie.poster_path, load);
      return posterPath === movie.poster_path
        ? movie
        : { ...movie, poster_path: posterPath };
    }),
  );

export const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));
