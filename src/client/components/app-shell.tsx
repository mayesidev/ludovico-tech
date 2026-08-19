import { useEffect, useState, type ReactNode } from "react";
import { Clapperboard, LoaderCircle, Ticket, X } from "lucide-react";
import type { AuthState } from "../api";
import type { Navigate, Tab } from "../types";
import { Button } from "./ui";
import { cn, formatMovieTitle } from "../lib/utils";
import { AppLink } from "./app-link";
import type { Movie } from "../api";
import {
  POSTER_REEL_IMAGE_WIDTH,
  POSTER_REEL_INTERVAL_MS,
} from "../lib/poster-reel";
import { Poster } from "./poster";

type AppHeaderProps = {
  action?: ReactNode;
  tab: Tab;
  auth: AuthState | null;
  onLogin: () => void;
  onNavigate: Navigate;
  onLogout: () => void;
};

export function AppHeader({
  action,
  tab,
  auth,
  onLogin,
  onNavigate,
  onLogout,
}: AppHeaderProps) {
  return (
    <header className="relative z-10 border-b border-border-subtle bg-canvas/80">
      <div className="mx-auto grid min-h-[88px] max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-5 md:grid-cols-[minmax(260px,1fr)_auto_minmax(260px,1fr)] lg:px-8">
        <AppLink
          aria-label="Ludovico Tech home"
          className="flex min-w-0 items-center gap-2.5 py-3 text-left sm:gap-3"
          href="/"
          onNavigate={onNavigate}
        >
          <span className="grid size-9 shrink-0 place-items-center border border-highlight text-highlight sm:size-10">
            <Clapperboard size={20} strokeWidth={2.25} />
          </span>
          <span className="w-min min-w-0">
            <span className="block whitespace-nowrap font-heading text-lg font-semibold tracking-tight text-text-primary sm:text-xl">
              Ludovico Tech
            </span>
            <span
              aria-label="A Pop Culture Re-education Program"
              className="hidden text-sm font-normal leading-[1.3] tracking-normal text-text-muted md:block"
            >
              <span aria-hidden="true" className="block whitespace-nowrap">
                A Pop Culture
              </span>
              <span aria-hidden="true" className="block whitespace-nowrap">
                Re-education Program
              </span>
            </span>
          </span>
        </AppLink>

        <nav
          aria-label="Primary navigation"
          className="col-span-2 row-start-2 flex min-h-[50px] items-stretch justify-center border-t border-border-subtle md:col-span-1 md:col-start-2 md:row-start-1 md:min-h-[87px] md:border-t-0"
        >
          <NavButton active={tab === "home"} href="/" onNavigate={onNavigate}>
            Now Showing
          </NavButton>
          <NavButton
            active={tab === "library"}
            href="/library"
            onNavigate={onNavigate}
          >
            Library
          </NavButton>
          <NavButton
            active={tab === "credits"}
            href="/credits"
            onNavigate={onNavigate}
          >
            Credits
          </NavButton>
        </nav>

        <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-start-3">
          {action}
          <AuthControls auth={auth} onLogin={onLogin} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}

function NavButton({
  active,
  href,
  onNavigate,
  children,
}: {
  active: boolean;
  href: string;
  onNavigate: Navigate;
  children: ReactNode;
}) {
  return (
    <AppLink
      aria-current={active ? "page" : undefined}
      href={href}
      onNavigate={onNavigate}
      className={cn(
        "nav-label relative grid min-w-0 place-items-center px-3 transition sm:min-w-32 sm:px-6",
        active
          ? "text-text-primary after:absolute after:inset-x-5 after:bottom-[-1px] after:h-[3px] after:bg-action"
          : "text-text-muted hover:text-text-primary",
      )}
    >
      {children}
    </AppLink>
  );
}

function AuthControls({
  auth,
  onLogin,
  onLogout,
}: {
  auth: AuthState | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  if (!auth || auth.local) return null;

  if (!auth.authenticated) {
    return (
      <Button
        className="header-label shrink-0 whitespace-nowrap"
        variant="secondary"
        onClick={onLogin}
      >
        Sign In
      </Button>
    );
  }

  return (
    <button
      aria-label={`Sign Out${auth.actor?.displayName ? ` ${auth.actor.displayName}` : ""}`}
      onClick={onLogout}
      className="header-label max-w-[120px] shrink-0 whitespace-nowrap rounded-sm border border-border-primary bg-surface/75 px-3 py-2 text-text-secondary hover:border-text-muted hover:bg-surface-elevated hover:text-text-primary sm:max-w-[180px]"
    >
      Sign Out
    </button>
  );
}

export function LoadingState() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <LoaderCircle className="animate-spin text-highlight" />
    </div>
  );
}

export function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      aria-live="assertive"
      className="fixed left-1/2 top-4 z-[60] flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 items-center justify-between gap-4 rounded-sm border border-danger/50 bg-danger-surface px-4 py-3 text-sm text-text-primary shadow-2xl shadow-black/60"
      role="alert"
    >
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss Error">
        <X size={16} />
      </button>
    </div>
  );
}

export function RollReveal({
  reel,
  starting,
  selected,
}: {
  reel: Movie[];
  starting: { posterPath: string | null; title: string } | null;
  selected: { posterPath: string | null; title: string } | null;
}) {
  const [reelIndex, setReelIndex] = useState(0);

  useEffect(() => {
    if (
      selected ||
      reel.length < 2 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const interval = window.setInterval(
      () => setReelIndex((index) => (index + 1) % reel.length),
      POSTER_REEL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [reel, selected]);

  const reelMovie = reel[reelIndex];
  const visibleMovie = selected
    ? { poster_path: selected.posterPath, title: selected.title }
    : (reelMovie ??
      (starting
        ? { poster_path: starting.posterPath, title: starting.title }
        : null));
  const visibleTitle = selected
    ? selected.title
    : reelMovie
      ? formatMovieTitle(reelMovie.title, reelMovie.version)
      : starting?.title;
  const announcement = selected
    ? `Now showing: ${selected.title}`
    : "Choosing a movie";

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="reveal app-background fixed inset-0 z-50 grid place-items-center bg-canvas/95 p-6"
      role="status"
    >
      <span className="sr-only">{announcement}</span>
      <div aria-hidden="true" className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 w-full max-w-[220px]">
          {visibleMovie ? (
            <Poster
              imageWidth={
                !selected && !reelMovie && starting
                  ? 500
                  : POSTER_REEL_IMAGE_WIDTH
              }
              key={
                selected?.title ?? reelMovie?.id ?? starting?.title ?? "empty"
              }
              large
              path={visibleMovie.poster_path}
              title={visibleTitle ?? visibleMovie.title}
            />
          ) : (
            <div className="poster-frame mx-auto grid aspect-[2/3] w-full max-w-[220px] place-items-center text-highlight">
              <Ticket size={40} />
            </div>
          )}
        </div>
        <p className="ui-label mb-3 text-highlight">
          {selected ? "Now Showing" : "Choosing a Movie"}
        </p>
        <h2 className="font-heading text-4xl font-medium tracking-tight text-text-primary sm:text-6xl">
          {visibleTitle ?? "The Posters Are Shuffling"}
        </h2>
      </div>
    </div>
  );
}
