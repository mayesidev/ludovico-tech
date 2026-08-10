import type { ReactNode } from "react";
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
import tmdbLogo from "../assets/tmdb-logo.svg";
import { AppLink } from "./app-link";

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
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-x-3 gap-y-3 px-5 py-4 sm:flex sm:justify-between sm:gap-2 lg:px-8">
        <AppLink
          aria-label="Ludovico Tech home"
          className="flex min-w-0 items-center gap-2.5 text-left sm:gap-3"
          href="/"
          onNavigate={onNavigate}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-marquee-light/40 bg-marquee-gold text-ink shadow-lg shadow-marquee-gold/15 sm:size-10 sm:rounded-2xl">
            <Clapperboard size={20} strokeWidth={2.5} />
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap font-display text-base font-bold tracking-normal text-cream sm:text-lg">
              Ludovico Tech
            </span>
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-marquee-gold/55 sm:block">
              A Pop Culture Re-education Program
            </span>
          </span>
        </AppLink>

        <div className="contents sm:flex sm:items-center sm:gap-3">
          <nav
            aria-label="Primary navigation"
            className="col-span-2 row-start-2 flex items-center justify-self-center gap-1 rounded-full border border-marquee-gold/15 bg-black/25 p-1 sm:col-auto sm:row-auto sm:justify-self-auto"
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
          <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end sm:col-auto sm:row-auto sm:justify-self-auto">
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
      className="max-w-[120px] truncate rounded-full border border-marquee-gold/15 px-3 py-2 text-xs text-zinc-400 hover:border-marquee-gold/35 hover:text-marquee-light sm:max-w-[180px]"
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
      className="mb-6 flex items-center justify-between rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"
      role="alert"
    >
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error">
        <X size={16} />
      </button>
    </div>
  );
}

export function RollReveal({ title }: { title: string }) {
  return (
    <div
      aria-live="polite"
      className="reveal fixed inset-0 z-50 grid place-items-center bg-ink/95 p-6 backdrop-blur-md"
      role="status"
    >
      <div className="text-center">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-[2rem] border border-marquee-light/40 bg-curtain/35 text-marquee-light shadow-[0_0_48px_rgba(216,172,76,0.16)]">
          <Ticket size={40} />
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-marquee-gold">
          The roll is in
        </p>
        <h2 className="font-display text-4xl font-bold text-cream sm:text-6xl">
          {title}
        </h2>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 mx-auto max-w-7xl border-t border-curtain/35 px-5 py-8 text-xs leading-5 text-zinc-600 lg:px-8">
      <a
        className="mb-3 inline-block"
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noreferrer"
        aria-label="The Movie Database"
      >
        <img
          alt="TMDB"
          className="h-3.5 w-auto"
          loading="lazy"
          src={tmdbLogo}
        />
      </a>
      <p>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  );
}
