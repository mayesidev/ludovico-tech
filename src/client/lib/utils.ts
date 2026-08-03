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

export const posterUrl = (path: string | null | undefined) =>
  path ? `https://image.tmdb.org/t/p/w500${path}` : null;
