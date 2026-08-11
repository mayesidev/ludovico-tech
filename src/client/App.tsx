import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  api,
  ApiError,
  type AuthState,
  type Movie,
  type NowShowing,
} from "./api";
import {
  AppHeader,
  ErrorNotice,
  Footer,
  LoadingState,
  RollReveal,
} from "./components/app-shell";
import { AddMovieDialog } from "./components/add-movie-dialog";
import { DeleteMovieDialog } from "./components/delete-movie-dialog";
import { EditMovieDialog } from "./components/edit-movie-dialog";
import { CollectionDetailPage } from "./components/collection-detail-page";
import { HomePage } from "./components/home-page";
import { LibraryPage } from "./components/library-page";
import { MovieDetailPage } from "./components/movie-detail-page";
import { Button } from "./components/ui";
import { parseRoute } from "./route";
import type { RunAction, Tab } from "./types";
import {
  POSTER_REEL_DURATION_MS,
  POSTER_REVEAL_DURATION_MS,
  selectPosterReel,
  wait,
} from "./lib/poster-reel";

type RollRevealState = {
  reel: Movie[];
  selected: { posterPath: string | null; title: string } | null;
};

export default function App() {
  const [route, setRoute] = useState(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  const [nowShowing, setNowShowing] = useState<NowShowing | null>(null);
  const [remaining, setRemaining] = useState<Movie[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
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

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await api.authMe());
    } catch {
      setAuth({ authenticated: false, actor: null, local: false });
    }
  }, []);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [current, list] = await Promise.all([
        api.nowShowing(),
        api.movies(),
      ]);
      setNowShowing(current.nowShowing);
      setRemaining(current.remainingCollectionMovies);
      setMovies(list.movies);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load the catalog",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  useEffect(() => {
    void Promise.resolve().then(refreshAuth);
  }, [refreshAuth]);

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
        await refresh(false);
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
    [refresh, refreshAuth],
  );

  const roll = useCallback(() => {
    void run(async () => {
      setRollReveal({ reel: selectPosterReel(movies), selected: null });
      try {
        const [result] = await Promise.all([
          api.roll(),
          wait(POSTER_REEL_DURATION_MS),
        ]);
        const selected = {
          posterPath: result.nowShowing.poster_path,
          title: result.nowShowing.title ?? result.rolledMovie.title,
        };
        setNowShowing(result.nowShowing);
        setRollReveal((current) => ({
          reel: current?.reel ?? [],
          selected,
        }));
        await wait(POSTER_REVEAL_DURATION_MS);
      } finally {
        setRollReveal(null);
      }
    });
  }, [movies, run]);

  const canMutate = auth?.authenticated === true;
  const login = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);
  const tab: Tab = route.page === "home" ? "home" : "library";
  const selectedMovie =
    route.page === "movie"
      ? (movies.find((movie) => movie.id === route.movieId) ?? null)
      : null;

  return (
    <div className="theater-background min-h-screen overflow-x-hidden text-zinc-100">
      <div className="grain" />
      <AppHeader
        action={
          canMutate ? (
            <Button
              aria-label="Add a movie"
              className="shrink-0 px-3 sm:px-4"
              disabled={busy}
              onClick={() => setAddingMovie(true)}
              ref={addMovieTriggerRef}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Add a movie</span>
            </Button>
          ) : undefined
        }
        tab={tab}
        auth={auth}
        onLogin={login}
        onNavigate={navigate}
        onLogout={() =>
          void run(
            () => api.logout(),
            () => setAuth({ authenticated: false, actor: null, local: false }),
          )
        }
      />

      <main className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-10 lg:px-8 lg:pt-16">
        {error && (
          <ErrorNotice message={error} onDismiss={() => setError(null)} />
        )}
        {loading ? (
          <LoadingState />
        ) : route.page === "home" ? (
          <HomePage
            nowShowing={nowShowing}
            remaining={remaining}
            movies={movies}
            busy={busy}
            canMutate={canMutate}
            onLogin={login}
            onNavigate={navigate}
            roll={roll}
            run={run}
          />
        ) : route.page === "library" ? (
          <LibraryPage
            movies={movies}
            canMutate={canMutate}
            onEdit={setEditingMovie}
            onNavigate={navigate}
          />
        ) : route.page === "collection" ? (
          <CollectionDetailPage
            busy={busy}
            canMutate={canMutate}
            collectionId={route.collectionId}
            key={route.collectionId}
            movies={movies}
            onLogin={login}
            onNavigate={navigate}
            returnTo={route.returnTo}
            run={run}
          />
        ) : (
          <MovieDetailPage
            canMutate={canMutate}
            movie={selectedMovie}
            onDelete={(movie) =>
              setDeletingMovie({
                movie,
                returnTo:
                  route.page === "movie" && route.returnTo === "now-showing"
                    ? "/"
                    : "/library",
              })
            }
            onEdit={setEditingMovie}
            onNavigate={navigate}
            returnTo={route.page === "movie" ? route.returnTo : "library"}
          />
        )}
      </main>

      <Footer />
      {rollReveal && (
        <RollReveal reel={rollReveal.reel} selected={rollReveal.selected} />
      )}
      {addingMovie && (
        <AddMovieDialog
          busy={busy}
          onAuthExpired={refreshAuth}
          onClose={() => setAddingMovie(false)}
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
