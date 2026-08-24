import type { ReturnTarget } from "./types";

export type AppRoute =
  | { page: "home" }
  | { page: "library" }
  | { page: "credits" }
  | { page: "tmdb-status" }
  | {
      page: "movie";
      movieId: string;
      returnTo: ReturnTarget;
    }
  | {
      page: "collection";
      collectionId: string;
      returnTo: ReturnTarget;
    }
  | { page: "not-found" };

const parseReturnTarget = (search: string): ReturnTarget => {
  const target = new URLSearchParams(search).get("from");
  return target === "now-showing" || target === "manager-office"
    ? target
    : "library";
};

export const parseRoute = (pathname: string, search = ""): AppRoute => {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return { page: "home" };
  if (segments.length === 1 && segments[0] === "library") {
    return { page: "library" };
  }
  if (segments.length === 1 && segments[0] === "credits") {
    return { page: "credits" };
  }
  if (segments.length === 1 && segments[0] === "manager-office") {
    return { page: "tmdb-status" };
  }
  if (segments.length === 2 && segments[0] === "movies") {
    try {
      return {
        page: "movie",
        movieId: decodeURIComponent(segments[1]),
        returnTo: parseReturnTarget(search),
      };
    } catch {
      return { page: "not-found" };
    }
  }
  if (segments.length === 2 && segments[0] === "collections") {
    try {
      return {
        page: "collection",
        collectionId: decodeURIComponent(segments[1]),
        returnTo: parseReturnTarget(search),
      };
    } catch {
      return { page: "not-found" };
    }
  }

  return { page: "not-found" };
};
