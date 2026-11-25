import { LoaderCircle, Ticket, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthState, HomeMovie } from "../api";
import {
  POSTER_REEL_IMAGE_WIDTH,
  POSTER_REEL_INTERVAL_MS,
} from "../lib/poster-reel";
import { cn, formatMovieTitle, type PosterImageWidth } from "../lib/utils";
import type { Navigate, Tab } from "../types";
import { AppLink } from "./app-link";
import { Poster } from "./poster";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

type AppHeaderProps = {
  action?: ReactNode;
  tab: Tab;
  auth: AuthState | null;
  onLogin: () => void;
  onNavigate: Navigate;
  onLogout: () => void;
  showTmdbStatus?: boolean;
};

export function AppHeader({
  action,
  tab,
  auth,
  onLogin,
  onNavigate,
  onLogout,
  showTmdbStatus = false,
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
          <span className="grid size-9 shrink-0 place-items-center sm:size-10">
            <img
              alt=""
              aria-hidden="true"
              className="size-full"
              src="/favicon.svg"
            />
          </span>
          <span className="w-min min-w-0">
            <span className="block font-heading text-lg font-semibold tracking-tight whitespace-nowrap text-text-primary sm:text-xl">
              Ludovico Tech
            </span>
            <span
              aria-label="A Pop Culture Re-education Program"
              className="hidden text-sm leading-tagline font-normal tracking-normal text-text-muted md:block"
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
          className="col-span-2 row-start-2 flex min-h-[50px] items-stretch justify-start overflow-x-auto border-t border-border-subtle md:col-span-1 md:col-start-2 md:row-start-1 md:min-h-[87px] md:justify-center md:overflow-visible md:border-t-0"
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
          {showTmdbStatus && (
            <NavButton
              active={tab === "tmdb-status"}
              href="/manager-office"
              onNavigate={onNavigate}
            >
              Manager's Office
            </NavButton>
          )}
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
        "nav-label relative grid shrink-0 place-items-center px-3 whitespace-nowrap transition sm:min-w-32 sm:px-6",
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
        className="shrink-0 whitespace-nowrap"
        labelStyle="header"
        variant="secondary"
        onClick={onLogin}
      >
        Sign In
      </Button>
    );
  }

  return (
    <Button
      aria-label={`Sign Out${auth.user?.displayName ? ` ${auth.user.displayName}` : ""}`}
      className="max-w-[120px] shrink-0 whitespace-nowrap sm:max-w-[180px]"
      labelStyle="header"
      onClick={onLogout}
      size="header"
      variant="secondary"
    >
      Sign Out
    </Button>
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
    <Alert
      aria-live="assertive"
      className="fixed top-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2"
      variant="notice"
    >
      <span>{message}</span>
      <Button
        aria-label="Dismiss Error"
        labelStyle="plain"
        onClick={onDismiss}
        size="bare"
        variant="plain"
      >
        <X size={16} />
      </Button>
    </Alert>
  );
}

type RevealMovie = { posterPath: string | null; title: string };
type ReelPoster = RevealMovie & { imageWidth: PosterImageWidth; key: string };

const resolveReelPoster = (
  reelMovie: HomeMovie | undefined,
  starting: RevealMovie | null,
  selected: RevealMovie | null,
): ReelPoster | null => {
  if (selected) {
    return {
      ...selected,
      imageWidth: POSTER_REEL_IMAGE_WIDTH,
      key: selected.title,
    };
  }
  if (reelMovie) {
    return {
      imageWidth: POSTER_REEL_IMAGE_WIDTH,
      key: reelMovie.id,
      posterPath: reelMovie.poster_path,
      title: formatMovieTitle(reelMovie.title, reelMovie.version),
    };
  }
  return starting
    ? { ...starting, imageWidth: 500, key: starting.title }
    : null;
};

export function RollReveal({
  reel,
  starting,
  selected,
}: {
  reel: HomeMovie[];
  starting: RevealMovie | null;
  selected: RevealMovie | null;
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
      () => setReelIndex((index) => Math.min(index + 1, reel.length - 1)),
      POSTER_REEL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [reel, selected]);

  const poster = resolveReelPoster(reel[reelIndex], starting, selected);
  const announcement = selected
    ? `Now showing: ${selected.title}`
    : "Rolling...";

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
          {poster ? (
            <Poster
              imageWidth={poster.imageWidth}
              key={poster.key}
              large
              path={poster.posterPath}
              title={poster.title}
            />
          ) : (
            <div className="poster-frame mx-auto grid aspect-[2/3] w-full max-w-[220px] place-items-center text-highlight">
              <Ticket size={40} />
            </div>
          )}
        </div>
        <p className="ui-label mb-3 text-highlight">
          {selected ? "Now Showing" : "Rolling..."}
        </p>
        <h2 className="font-heading text-4xl font-medium tracking-tight text-text-primary sm:text-6xl">
          {poster?.title ?? "The Posters Are Shuffling"}
        </h2>
      </div>
    </div>
  );
}
