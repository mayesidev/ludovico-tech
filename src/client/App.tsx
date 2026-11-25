import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AuthState, type Movie } from "./api";
import { AddMovieDialog } from "./components/add-movie-dialog";
import {
  AppHeader,
  ErrorNotice,
  LoadingState,
  RollReveal,
} from "./components/app-shell";
import { CollectionDetailPage } from "./components/collection-detail-page";
import { CreditsPage } from "./components/credits-page";
import { DeleteMovieDialog } from "./components/delete-movie-dialog";
import { EditMovieDialog } from "./components/edit-movie-dialog";
import { HomePage } from "./components/home-page";
import { LibraryPage } from "./components/library-page";
import { MovieDetailPage } from "./components/movie-detail-page";
import { TmdbStatusPage } from "./components/tmdb-status-page";
import { Button } from "./components/ui";
import { useCatalogRoute } from "./lib/use-catalog-route";
import { usePosterRoll } from "./lib/use-poster-roll";
import type { ReturnTarget, RunAction, Tab } from "./types";

export default function App() {
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [deletingMovie, setDeletingMovie] = useState<{
    movie: Movie;
    returnTo: string;
  } | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [addingMovie, setAddingMovie] = useState(false);
  const addMovieTriggerRef = useRef<HTMLButtonElement>(null);
  const catalog = useCatalogRoute(setError);
  const {
    navigate,
    nowShowing,
    openCreatedMovie,
    posterReelMovies,
    refresh,
    refreshMovieDetail,
    route,
    setNowShowing,
  } = catalog;

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await api.authMe());
    } catch {
      setAuth({ authenticated: false, user: null, local: false });
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshAuth);
  }, [refreshAuth]);

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

  const canMutate = auth?.authenticated === true;
  const { roll, rollReveal } = usePosterRoll({
    authenticated: canMutate,
    nowShowing,
    page: route.page,
    posterReelMovies,
    run,
    setNowShowing,
  });

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
              className="shrink-0"
              disabled={busy}
              labelStyle="header"
              onClick={() => setAddingMovie(true)}
              ref={addMovieTriggerRef}
              size="responsive"
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

      <main className="relative z-10 mx-auto max-w-7xl px-5 pt-9 pb-20 lg:px-8 lg:pt-12">
        <AppPage
          authReady={auth !== null}
          busy={busy}
          canMutate={canMutate}
          catalog={catalog}
          catalogRevision={catalogRevision}
          onAuthExpired={refreshAuth}
          onDelete={(movie, returnTo) => setDeletingMovie({ movie, returnTo })}
          onEdit={setEditingMovie}
          onLogin={login}
          roll={roll}
          run={run}
        />
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
          onCreated={openCreatedMovie}
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

const returnPaths: Record<ReturnTarget, string> = {
  library: "/library",
  "manager-office": "/manager-office",
  "now-showing": "/",
};

function AppPage({
  authReady,
  busy,
  canMutate,
  catalog,
  catalogRevision,
  onAuthExpired,
  onDelete,
  onEdit,
  onLogin,
  roll,
  run,
}: {
  authReady: boolean;
  busy: boolean;
  canMutate: boolean;
  catalog: ReturnType<typeof useCatalogRoute>;
  catalogRevision: number;
  onAuthExpired: () => Promise<void>;
  onDelete: (movie: Movie, returnTo: string) => void;
  onEdit: (movie: Movie) => void;
  onLogin: () => void;
  roll: () => void;
  run: RunAction;
}) {
  const { route, navigate } = catalog;
  if (route.page === "credits") return <CreditsPage />;
  if (route.page === "tmdb-status") {
    return authReady ? (
      <TmdbStatusPage
        canMutate={canMutate}
        onAuthExpired={onAuthExpired}
        onNavigate={navigate}
      />
    ) : (
      <LoadingState />
    );
  }
  if (catalog.loading) return <LoadingState />;

  switch (route.page) {
    case "home":
      return (
        <HomePage
          nowShowing={catalog.nowShowing}
          hasNextCollectionMovie={catalog.hasNextCollectionMovie}
          watchedMovies={catalog.watchedMovies}
          busy={busy}
          canMutate={canMutate}
          onLogin={onLogin}
          onNavigate={navigate}
          roll={roll}
          run={run}
        />
      );
    case "library":
      return (
        <LibraryPage
          canMutate={canMutate}
          onEdit={onEdit}
          onNavigate={navigate}
          reloadToken={catalogRevision}
        />
      );
    case "collection":
      return (
        <CollectionDetailPage
          audit={catalog.collectionDetail?.audit}
          busy={busy}
          canMutate={canMutate}
          collectionId={route.collectionId}
          key={route.collectionId}
          movies={catalog.collectionMovies}
          onLogin={onLogin}
          onNavigate={navigate}
          returnTo={route.returnTo}
          run={run}
        />
      );
    case "movie":
    case "not-found": {
      const returnTo = route.page === "movie" ? route.returnTo : "library";
      if (route.page === "movie" && catalog.movieDetailLoading)
        return <LoadingState />;
      return (
        <MovieDetailPage
          canMutate={canMutate}
          movie={catalog.movieDetail}
          onDelete={(movie) => onDelete(movie, returnPaths[returnTo])}
          onEdit={onEdit}
          onNavigate={navigate}
          returnTo={returnTo}
        />
      );
    }
  }
}
