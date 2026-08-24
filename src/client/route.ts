export type AppRoute =
  | { page: "home" }
  | { page: "library" }
  | { page: "credits" }
  | { page: "tmdb-status" }
  | {
      page: "movie";
      movieId: string;
      returnTo: "library" | "now-showing";
    }
  | {
      page: "collection";
      collectionId: string;
      returnTo: "library" | "now-showing";
    }
  | { page: "not-found" };

export const parseRoute = (pathname: string, search = ""): AppRoute => {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return { page: "home" };
  if (segments.length === 1 && segments[0] === "library") {
    return { page: "library" };
  }
  if (segments.length === 1 && segments[0] === "credits") {
    return { page: "credits" };
  }
  if (segments.length === 1 && segments[0] === "tmdb-status") {
    return { page: "tmdb-status" };
  }
  if (segments.length === 2 && segments[0] === "movies") {
    try {
      return {
        page: "movie",
        movieId: decodeURIComponent(segments[1]),
        returnTo:
          new URLSearchParams(search).get("from") === "now-showing"
            ? "now-showing"
            : "library",
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
        returnTo:
          new URLSearchParams(search).get("from") === "now-showing"
            ? "now-showing"
            : "library",
      };
    } catch {
      return { page: "not-found" };
    }
  }

  return { page: "not-found" };
};
