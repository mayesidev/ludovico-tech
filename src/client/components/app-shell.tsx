import { useEffect, useState, type ReactNode } from "react";
import {
  Clapperboard,
  LoaderCircle,
  Sparkles,
  Table2,
  Ticket,
  X,
} from "lucide-react";
import type { AuthState } from "../api";
import type { Navigate, Tab } from "../types";
import { Button } from "./ui";
import { cn } from "../lib/utils";
import { AppLink } from "./app-link";
import type { Movie } from "../api";
import { POSTER_REEL_INTERVAL_MS } from "../lib/poster-reel";
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
    <header className="relative z-10 border-b border-curtain/50 bg-ink/85 shadow-[0_1px_24px_rgba(120,23,41,0.12)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-5 py-4 md:flex md:gap-2 lg:px-8">
        <div className="contents md:mr-auto md:flex md:min-w-0 md:items-center md:gap-4">
          <AppLink
            aria-label="Ludovico Tech home"
            className="flex min-w-0 items-center gap-2.5 text-left sm:gap-3 md:px-5"
            href="/"
            onNavigate={onNavigate}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-marquee-light/40 bg-marquee-gold text-ink shadow-lg shadow-marquee-gold/15 sm:size-10 sm:rounded-2xl">
              <Clapperboard size={20} strokeWidth={2.5} />
            </span>
            <span className="w-min min-w-0">
              <span className="block whitespace-nowrap font-display text-base font-bold tracking-normal text-cream sm:text-lg md:text-[19px]">
                Ludovico Tech
              </span>
              <span
                aria-label="A Pop Culture Re-education Program"
                className="hidden text-[10px] font-bold uppercase leading-[1.4] tracking-[0.02em] text-marquee-gold/55 md:block"
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

          <AppLink
            aria-current={tab === "credits" ? "page" : undefined}
            className={cn(
              "col-start-1 row-start-2 justify-self-start text-xs font-semibold transition sm:text-sm md:col-auto md:row-auto",
              tab === "credits"
                ? "text-cream"
                : "text-zinc-500 hover:text-marquee-light",
            )}
            href="/credits"
            onNavigate={onNavigate}
          >
            Credits
          </AppLink>
        </div>

        <div className="contents md:flex md:items-center md:gap-3">
          <nav
            aria-label="Primary navigation"
            className="col-start-2 row-start-2 flex items-center justify-self-end gap-1 rounded-full border border-marquee-gold/15 bg-black/25 p-1 md:col-auto md:row-auto md:justify-self-auto"
          >
            <NavButton
              active={tab === "home"}
              href="/"
              onNavigate={onNavigate}
              icon={<Sparkles size={15} />}
            >
              Now showing
            </NavButton>
            <NavButton
              active={tab === "library"}
              href="/library"
              onNavigate={onNavigate}
              icon={<Table2 size={15} />}
            >
              Library
            </NavButton>
          </nav>
          <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-auto md:row-auto md:justify-self-auto">
            {action}
            <AuthControls auth={auth} onLogin={onLogin} onLogout={onLogout} />
          </div>
        </div>
      </div>
    </header>
  );
}

function NavButton({
  active,
  href,
  onNavigate,
  icon,
  children,
}: {
  active: boolean;
  href: string;
  onNavigate: Navigate;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppLink
      aria-current={active ? "page" : undefined}
      href={href}
      onNavigate={onNavigate}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-2 text-xs font-semibold transition sm:gap-2 sm:px-3",
        active
          ? "bg-curtain text-cream shadow-inner shadow-marquee-gold/10 ring-1 ring-marquee-gold/20"
          : "text-zinc-500 hover:bg-curtain/15 hover:text-marquee-light",
      )}
    >
      <span className="hidden sm:inline-flex">{icon}</span>
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
        variant="secondary"
        onClick={onLogin}
      >
        Sign in
      </Button>
    );
  }

  return (
    <button
      aria-label={`Sign out${auth.actor?.displayName ? ` ${auth.actor.displayName}` : ""}`}
      onClick={onLogout}
      className="max-w-[120px] shrink-0 whitespace-nowrap rounded-full border border-marquee-gold/15 px-3 py-2 text-xs text-zinc-400 hover:border-marquee-gold/35 hover:text-marquee-light sm:max-w-[180px]"
    >
      Sign out
    </button>
  );
}

export function LoadingState() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <LoaderCircle className="animate-spin text-marquee-gold" />
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
      className="fixed left-1/2 top-4 z-[60] flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-red-300/30 bg-[#2b0a11] px-4 py-3 text-sm text-red-100 shadow-2xl shadow-black/60"
      role="alert"
    >
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error">
        <X size={16} />
      </button>
    </div>
  );
}

export function RollReveal({
  reel,
  selected,
}: {
  reel: Movie[];
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

  const visibleMovie = selected
    ? { poster_path: selected.posterPath, title: selected.title }
    : reel[reelIndex];
  const announcement = selected
    ? `Now showing: ${selected.title}`
    : "Choosing a movie";

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="reveal fixed inset-0 z-50 grid place-items-center bg-ink/95 p-6 backdrop-blur-md"
      role="status"
    >
      <span className="sr-only">{announcement}</span>
      <div aria-hidden="true" className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 w-full max-w-[220px]">
          {visibleMovie ? (
            <Poster
              key={selected?.title ?? reel[reelIndex]?.id ?? "empty"}
              large
              path={visibleMovie.poster_path}
              title={visibleMovie.title}
            />
          ) : (
            <div className="mx-auto grid aspect-[2/3] w-full max-w-[220px] place-items-center rounded-2xl border border-marquee-light/40 bg-curtain/35 text-marquee-light shadow-[0_0_48px_rgba(216,172,76,0.16)]">
              <Ticket size={40} />
            </div>
          )}
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-marquee-gold">
          {selected ? "Now showing" : "Choosing a movie"}
        </p>
        <h2 className="font-display text-4xl font-bold text-cream sm:text-6xl">
          {visibleMovie?.title ?? "The posters are shuffling"}
        </h2>
      </div>
    </div>
  );
}
