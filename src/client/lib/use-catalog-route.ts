import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type CollectionDetail,
  type HomeMovie,
  type Movie,
  type MovieDetail,
  type NowShowing,
} from "../api";
import { parseRoute } from "../route";

export function useCatalogRoute(setError: (error: string | null) => void) {
  const [route, setRoute] = useState(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  const [nowShowing, setNowShowing] = useState<NowShowing | null>(null);
  const [hasNextCollectionMovie, setHasNextCollectionMovie] = useState(false);
  const [watchedMovies, setWatchedMovies] = useState<HomeMovie[]>([]);
  const [posterReelMovies, setPosterReelMovies] = useState<HomeMovie[]>([]);
  const [collectionMovies, setCollectionMovies] = useState<Movie[]>([]);
  const [collectionDetail, setCollectionDetail] =
    useState<CollectionDetail | null>(null);
  const [movieDetail, setMovieDetail] = useState<MovieDetail | null>(null);
  const [movieDetailLoading, setMovieDetailLoading] = useState(
    route.page === "movie",
  );
  const [loading, setLoading] = useState(true);
  const addedMovieDetailRef = useRef<MovieDetail | null>(null);
  const activeRouteRef = useRef(route);
  const pageRequestSequence = useRef(0);
  const movieRequestSequence = useRef(0);

  const syncRoute = useCallback(() => {
    const nextRoute = parseRoute(
      window.location.pathname,
      window.location.search,
    );
    activeRouteRef.current = nextRoute;
    setRoute(nextRoute);
    setLoading(nextRoute.page === "home" || nextRoute.page === "collection");
    setMovieDetailLoading(nextRoute.page === "movie");
    setError(null);
  }, [setError]);

  const refresh = useCallback(
    async (showLoading = true) => {
      const requestRoute = activeRouteRef.current;
      const sequence = ++pageRequestSequence.current;
      const isCurrent = () =>
        activeRouteRef.current === requestRoute &&
        sequence === pageRequestSequence.current;
      if (
        requestRoute.page !== "home" &&
        requestRoute.page !== "library" &&
        requestRoute.page !== "collection"
      ) {
        if (isCurrent()) setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      try {
        if (requestRoute.page === "home") {
          const home = await api.home();
          if (!isCurrent()) return;
          setNowShowing(home.nowShowing);
          setHasNextCollectionMovie(home.hasNextCollectionMovie);
          setWatchedMovies(home.watchedMovies);
          setPosterReelMovies(home.posterReelMovies);
        } else if (requestRoute.page === "collection") {
          const result = await api.collection(requestRoute.collectionId);
          if (!isCurrent()) return;
          setCollectionMovies(result.movies);
          setCollectionDetail(result.collection);
        }
        setError(null);
      } catch (cause) {
        if (!isCurrent()) return;
        if (
          requestRoute.page === "collection" &&
          cause instanceof ApiError &&
          cause.status === 404
        ) {
          setCollectionMovies([]);
          setCollectionDetail(null);
          setError(null);
        } else {
          setError(
            cause instanceof Error ? cause.message : "Unable to load this page",
          );
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [setError],
  );

  const refreshMovieDetail = useCallback(
    async (showLoading = true) => {
      const requestRoute = activeRouteRef.current;
      const sequence = ++movieRequestSequence.current;
      const isCurrent = () =>
        activeRouteRef.current === requestRoute &&
        sequence === movieRequestSequence.current;
      if (requestRoute.page !== "movie") {
        setMovieDetail(null);
        setMovieDetailLoading(false);
        return;
      }
      if (addedMovieDetailRef.current?.id === requestRoute.movieId) {
        setMovieDetail(addedMovieDetailRef.current);
        addedMovieDetailRef.current = null;
        setMovieDetailLoading(false);
        return;
      }
      if (showLoading) setMovieDetailLoading(true);
      try {
        const result = await api.movie(requestRoute.movieId);
        if (!isCurrent()) return;
        setMovieDetail(result.movie);
        setError(null);
      } catch (cause) {
        if (!isCurrent()) return;
        setMovieDetail(null);
        if (cause instanceof ApiError && cause.status === 404) {
          setError(null);
        } else {
          setError(
            cause instanceof Error ? cause.message : "Unable to load the movie",
          );
        }
      } finally {
        if (isCurrent()) setMovieDetailLoading(false);
      }
    },
    [setError],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh();
    });
    return () => {
      cancelled = true;
      pageRequestSequence.current += 1;
    };
  }, [refresh, route]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refreshMovieDetail();
    });
    return () => {
      cancelled = true;
      movieRequestSequence.current += 1;
    };
  }, [refreshMovieDetail, route]);

  useEffect(() => {
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [syncRoute]);

  const navigate = useCallback(
    (path: string) => {
      window.history.pushState(null, "", path);
      syncRoute();
    },
    [syncRoute],
  );

  const openCreatedMovie = (movie: MovieDetail) => {
    addedMovieDetailRef.current = movie;
    setMovieDetail(movie);
    setMovieDetailLoading(false);
    navigate(`/movies/${encodeURIComponent(movie.id)}`);
  };

  return {
    collectionDetail,
    collectionMovies,
    hasNextCollectionMovie,
    loading,
    movieDetail,
    movieDetailLoading,
    navigate,
    nowShowing,
    openCreatedMovie,
    posterReelMovies,
    refresh,
    refreshMovieDetail,
    route,
    setNowShowing,
    watchedMovies,
  };
}
