export type AppRoute =
  | { page: "home" }
  | { page: "library" }
  | { page: "movie"; movieId: string }
  | { page: "not-found" };

export const parseRoute = (pathname: string): AppRoute => {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return { page: "home" };
  if (segments.length === 1 && segments[0] === "library") {
    return { page: "library" };
  }
  if (segments.length === 2 && segments[0] === "movies") {
    try {
      return { page: "movie", movieId: decodeURIComponent(segments[1]) };
    } catch {
      return { page: "not-found" };
    }
  }

  return { page: "not-found" };
};
