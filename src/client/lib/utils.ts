import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatDate = (value: string | null | undefined) => {
  if (!value) return "Unknown date";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const formatRuntime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
};

export const formatMovieTitle = (
  title: string | null | undefined,
  version: string | null | undefined,
) => (title && version ? `${title} (${version})` : (title ?? ""));

export type PosterImageWidth = 342 | 500;

export const posterUrl = (
  path: string | null | undefined,
  width: PosterImageWidth = 500,
) => (path ? `https://image.tmdb.org/t/p/w${width}${path}` : null);
