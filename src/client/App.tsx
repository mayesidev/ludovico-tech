import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  api,
  ApiError,
  type AuthState,
  type CollectionDetail,
  type HomeMovie,
  type Movie,
  type MovieDetail,
  type NowShowing,
} from "./api";
import {
  AppHeader,
  ErrorNotice,
  LoadingState,
  RollReveal,
} from "./components/app-shell";
import { AddMovieDialog } from "./components/add-movie-dialog";
import { DeleteMovieDialog } from "./components/delete-movie-dialog";
import { EditMovieDialog } from "./components/edit-movie-dialog";
import { CollectionDetailPage } from "./components/collection-detail-page";
import { CreditsPage } from "./components/credits-page";
import { HomePage } from "./components/home-page";
import { LibraryPage } from "./components/library-page";
import { MovieDetailPage } from "./components/movie-detail-page";
import { TmdbStatusPage } from "./components/tmdb-status-page";
import { Button } from "./components/ui";
import { parseRoute } from "./route";
import type { RunAction, Tab } from "./types";
import { formatMovieTitle } from "./lib/utils";
import {
  POSTER_REEL_LEAD_IN_MS,
  POSTER_REEL_LIMIT,
  POSTER_REVEAL_DURATION_MS,
  posterReelDurationMs,
  preloadPosterPath,
  preloadPosterReel,
  selectPosterReel,
  wait,
} from "./lib/poster-reel";

type RollRevealState = {
  reel: HomeMovie[];
  starting: { posterPath: string | null; title: string } | null;
  selected: { posterPath: string | null; title: string } | null;
};

export default function App() {
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
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [movieDetail, setMovieDetail] = useState<MovieDetail | null>(null);
  const [movieDetailLoading, setMovieDetailLoading] = useState(
    route.page === "movie",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollReveal, setRollReveal] = useState<RollRevealState | null>(null);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [deletingMovie, setDeletingMovie] = useState<{
    movie: Movie;
    returnTo: string;
  } | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [addingMovie, setAddingMovie] = useState(false);
  const addMovieTriggerRef = useRef<HTMLButtonElement>(null);
  const addedMovieDetailRef = useRef<MovieDetail | null>(null);
  const preparedPosterReelRef = useRef<Promise<HomeMovie[]> | null>(null);
  const preparedPosterReelSourceRef = useRef<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await api.authMe());
    } catch {
      setAuth({ authenticated: false, user: null, local: false });
    }
  }, []);

  const refresh = useCallback(
    async (showLoading = true) => {
      if (
        route.page !== "home" &&
        route.page !== "library" &&
        route.page !== "collection"
      ) {
        if (showLoading) setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      try {
        if (route.page === "home") {
          const home = await api.home();
          setNowShowing(home.nowShowing);
          setHasNextCollectionMovie(home.hasNextCollectionMovie);
          setWatchedMovies(home.watchedMovies);
          setPosterReelMovies(home.posterReelMovies);
        } else if (route.page === "collection") {
          const result = await api.collection(route.collectionId);
          setCollectionMovies(result.movies);
          setCollectionDetail(result.collection);
        }
        setError(null);
      } catch (cause) {
        if (
          route.page === "collection" &&
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
        if (showLoading) setLoading(false);
      }
    },
    [route],
  );

  const refreshMovieDetail = useCallback(
    async (showLoading = true) => {
      if (route.page !== "movie") {
        setMovieDetail(null);
        setMovieDetailLoading(false);
        return;
      }
      if (addedMovieDetailRef.current?.id === route.movieId) {
        setMovieDetail(addedMovieDetailRef.current);
        addedMovieDetailRef.current = null;
        setMovieDetailLoading(false);
        return;
      }
      if (showLoading) setMovieDetailLoading(true);
      try {
        setMovieDetail((await api.movie(route.movieId)).movie);
      } catch (cause) {
        setMovieDetail(null);
        if (!(cause instanceof ApiError && cause.status === 404)) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load the movie",
          );
        }
      } finally {
        if (showLoading) setMovieDetailLoading(false);
      }
    },
    [route],
  );

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  useEffect(() => {
    void Promise.resolve().then(refreshAuth);
  }, [refreshAuth]);

  useEffect(() => {
    void Promise.resolve().then(() => refreshMovieDetail());
  }, [refreshMovieDetail]);

  useEffect(() => {
    if (
      route.page !== "home" ||
      auth?.authenticated !== true ||
      posterReelMovies.length === 0
    ) {
      preparedPosterReelRef.current = null;
      preparedPosterReelSourceRef.current = null;
      return;
    }
    const source = posterReelMovies
      .map((movie) => `${movie.id}:${movie.poster_path ?? ""}`)
      .join("|");
    if (
      preparedPosterReelSourceRef.current === source &&
      preparedPosterReelRef.current
    )
      return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const reel = selectPosterReel(
      posterReelMovies,
      Math.random,
      reducedMotion ? 1 : POSTER_REEL_LIMIT,
    );
    preparedPosterReelSourceRef.current = source;
    preparedPosterReelRef.current = preloadPosterReel(reel);
  }, [auth?.authenticated, posterReelMovies, route.page]);

  useEffect(() => {
    const handlePopState = () =>
      setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setRoute(parseRoute(window.location.pathname, window.location.search));
  }, []);

  const run = useCallback<RunAction>(
    async (action, after) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        after?.();
        setCatalogRevision((current) => current + 1);
        await refresh(false);
        await refreshMovieDetail(false);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          setEditingMovie(null);
          setDeletingMovie(null);
          await refreshAuth();
          setError("Your session ended. Sign in again to make changes.");
        } else {
          setError(cause instanceof Error ? cause.message : "Action failed");
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh, refreshAuth, refreshMovieDetail],
  );

  const roll = useCallback(() => {
    void run(async () => {
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const preparedReel =
        preparedPosterReelRef.current ??
        preloadPosterReel(
          selectPosterReel(
            posterReelMovies,
            Math.random,
            reducedMotion ? 1 : POSTER_REEL_LIMIT,
          ),
        );
      preparedPosterReelRef.current = null;
      const starting = nowShowing?.title
        ? {
            posterPath: nowShowing.poster_path,
            title: formatMovieTitle(nowShowing.title, nowShowing.version),
          }
        : null;
      setRollReveal({ reel: [], starting, selected: null });
      try {
        const [reel, result] = await Promise.all([
          preparedReel,
          api.roll(),
          wait(POSTER_REEL_LEAD_IN_MS),
        ]);
        setRollReveal((current) => (current ? { ...current, reel } : current));
        const [posterPath] = await Promise.all([
          preloadPosterPath(result.nowShowing.poster_path),
          wait(posterReelDurationMs(reel.length)),
        ]);
        const selected = {
          posterPath,
          title: formatMovieTitle(
            result.nowShowing.title ?? result.rolledMovie.title,
            result.nowShowing.version ?? result.rolledMovie.version,
          ),
        };
        setNowShowing(result.nowShowing);
        setRollReveal((current) => ({
          reel: current?.reel ?? [],
          starting: current?.starting ?? null,
          selected,
        }));
        await wait(POSTER_REVEAL_DURATION_MS);
      } finally {
        setRollReveal(null);
      }
    });
  }, [nowShowing, posterReelMovies, run]);

  const logout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.logout();
      setAuth({ authenticated: false, user: null, local: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out");
    } finally {
      setBusy(false);
    }
  }, []);

  const canMutate = auth?.authenticated === true;
  const login = useCallback(() => {
    const params = new URLSearchParams({
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
    window.location.href = `/api/auth/google?${params.toString()}`;
  }, []);
  const tab: Tab =
    route.page === "home"
      ? "home"
      : route.page === "credits"
        ? "credits"
        : route.page === "tmdb-status"
          ? "tmdb-status"
          : "library";
  return (
    <div className="app-background min-h-screen overflow-x-hidden text-text-primary">
      <AppHeader
        action={
          canMutate ? (
            <Button
              aria-label="Add a Movie"
              className="header-label shrink-0 px-3 sm:px-4"
              disabled={busy}
              onClick={() => setAddingMovie(true)}
              ref={addMovieTriggerRef}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Add a Movie</span>
            </Button>
          ) : undefined
        }
        tab={tab}
        auth={auth}
        onLogin={login}
        onNavigate={navigate}
        onLogout={() => void logout()}
        showTmdbStatus={canMutate}
      />

      <main className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-9 lg:px-8 lg:pt-12">
        {route.page === "credits" ? (
          <CreditsPage />
        ) : route.page === "tmdb-status" ? (
          auth === null ? (
            <LoadingState />
          ) : (
            <TmdbStatusPage canMutate={canMutate} onNavigate={navigate} />
          )
        ) : loading ? (
          <LoadingState />
        ) : route.page === "home" ? (
          <HomePage
            nowShowing={nowShowing}
            hasNextCollectionMovie={hasNextCollectionMovie}
            watchedMovies={watchedMovies}
            busy={busy}
            canMutate={canMutate}
            onLogin={login}
            onNavigate={navigate}
            roll={roll}
            run={run}
          />
        ) : route.page === "library" ? (
          <LibraryPage
            canMutate={canMutate}
            onEdit={setEditingMovie}
            onNavigate={navigate}
            reloadToken={catalogRevision}
          />
        ) : route.page === "collection" ? (
          <CollectionDetailPage
            audit={collectionDetail?.audit}
            busy={busy}
            canMutate={canMutate}
            collectionId={route.collectionId}
            key={route.collectionId}
            movies={collectionMovies}
            onLogin={login}
            onNavigate={navigate}
            returnTo={route.returnTo}
            run={run}
          />
        ) : route.page === "movie" && movieDetailLoading ? (
          <LoadingState />
        ) : (
          <MovieDetailPage
            canMutate={canMutate}
            movie={movieDetail}
            onDelete={(movie) =>
              setDeletingMovie({
                movie,
                returnTo:
                  route.page === "movie" && route.returnTo === "now-showing"
                    ? "/"
                    : route.page === "movie" &&
                        route.returnTo === "manager-office"
                      ? "/manager-office"
                      : "/library",
              })
            }
            onEdit={setEditingMovie}
            onNavigate={navigate}
            returnTo={route.page === "movie" ? route.returnTo : "library"}
          />
        )}
      </main>

      {error && (
        <ErrorNotice message={error} onDismiss={() => setError(null)} />
      )}
      {rollReveal && (
        <RollReveal
          reel={rollReveal.reel}
          starting={rollReveal.starting}
          selected={rollReveal.selected}
        />
      )}
      {addingMovie && (
        <AddMovieDialog
          busy={busy}
          onAuthExpired={refreshAuth}
          onClose={() => setAddingMovie(false)}
          onCreated={(movie) => {
            addedMovieDetailRef.current = movie;
            setMovieDetail(movie);
            setMovieDetailLoading(false);
            navigate(`/movies/${encodeURIComponent(movie.id)}`);
          }}
          run={run}
        />
      )}
      {editingMovie && (
        <EditMovieDialog
          busy={busy}
          movie={editingMovie}
          onAuthExpired={refreshAuth}
          onClose={() => setEditingMovie(null)}
          run={run}
        />
      )}
      {deletingMovie && (
        <DeleteMovieDialog
          busy={busy}
          movie={deletingMovie.movie}
          onClose={() => setDeletingMovie(null)}
          onConfirm={() => {
            const { movie, returnTo } = deletingMovie;
            void run(
              () => api.deleteMovie(movie.id),
              () => {
                setDeletingMovie(null);
                navigate(returnTo);
              },
            );
          }}
        />
      )}
    </div>
  );
}
