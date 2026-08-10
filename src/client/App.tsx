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
import { EditMovieDialog } from "./components/edit-movie-dialog";
import { FranchiseDetailPage } from "./components/franchise-detail-page";
import { HomePage } from "./components/home-page";
import { LibraryPage } from "./components/library-page";
import { MovieDetailPage } from "./components/movie-detail-page";
import { Button } from "./components/ui";
import { parseRoute } from "./route";
import type { RunAction, Tab } from "./types";

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
  const [rolledTitle, setRolledTitle] = useState<string | null>(null);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
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
      setRemaining(current.remainingFranchiseMovies);
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
      const result = await api.roll();
      setRolledTitle(result.rolledMovie.title);

      if (result.needsOrder) {
        const franchiseId =
          result.nowShowing.franchise_id ??
          result.franchiseMovies[0]?.franchise_id;
        if (franchiseId) {
          navigate(
            `/franchises/${encodeURIComponent(franchiseId)}?from=now-showing`,
          );
        }
      }

      window.setTimeout(() => setRolledTitle(null), 1800);
    });
  }, [navigate, run]);

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
        ) : route.page === "franchise" ? (
          <FranchiseDetailPage
            busy={busy}
            canMutate={canMutate}
            franchiseId={route.franchiseId}
            key={route.franchiseId}
            movies={movies}
            onLogin={login}
            onNavigate={navigate}
            returnTo={route.returnTo}
            run={run}
          />
        ) : (
          <MovieDetailPage movie={selectedMovie} onNavigate={navigate} />
        )}
      </main>

      <Footer />
      {rolledTitle && <RollReveal title={rolledTitle} />}
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
          onClose={() => setEditingMovie(null)}
          run={run}
        />
      )}
    </div>
  );
}
