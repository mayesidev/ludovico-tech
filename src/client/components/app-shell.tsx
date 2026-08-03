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
import type { Tab } from "../types";
import { Button } from "./ui";
import { cn } from "../lib/utils";

type AppHeaderProps = {
  tab: Tab;
  auth: AuthState | null;
  onTabChange: (tab: Tab) => void;
  onLogout: () => void;
};

export function AppHeader({
  tab,
  auth,
  onTabChange,
  onLogout,
}: AppHeaderProps) {
  return (
    <header className="relative z-10 border-b border-white/8 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
        <button
          className="flex items-center gap-3 text-left"
          onClick={() => onTabChange("home")}
        >
          <span className="grid size-10 place-items-center rounded-2xl bg-lime-300 text-zinc-950 shadow-lg shadow-lime-300/10">
            <Clapperboard size={20} strokeWidth={2.5} />
          </span>
          <span>
            <span className="block font-display text-lg font-bold tracking-tight">
              Movie List
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              The watch club
            </span>
          </span>
        </button>

        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] p-1">
            <NavButton
              active={tab === "home"}
              onClick={() => onTabChange("home")}
              icon={<Sparkles size={15} />}
            >
              Now showing
            </NavButton>
            <NavButton
              active={tab === "library"}
              onClick={() => onTabChange("library")}
              icon={<Table2 size={15} />}
            >
              Library
            </NavButton>
          </nav>
          <AuthControls auth={auth} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition",
        active ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function AuthControls({
  auth,
  onLogout,
}: {
  auth: AuthState | null;
  onLogout: () => void;
}) {
  if (!auth || auth.local) return null;

  if (!auth.authenticated) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          window.location.href = "/api/auth/google";
        }}
      >
        Sign in
      </Button>
    );
  }

  return (
    <button
      onClick={onLogout}
      className="hidden max-w-[180px] truncate rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white sm:block"
    >
      {auth.actor?.email}
    </button>
  );
}

export function LoadingState() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <LoaderCircle className="animate-spin text-lime-300" />
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
    <div className="mb-6 flex items-center justify-between rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error">
        <X size={16} />
      </button>
    </div>
  );
}

export function RollReveal({ title }: { title: string }) {
  return (
    <div className="reveal fixed inset-0 z-50 grid place-items-center bg-ink/90 p-6 backdrop-blur-md">
      <div className="text-center">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-[2rem] border border-lime-300/30 bg-lime-300/10 text-lime-300">
          <Ticket size={40} />
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-lime-300">
          The roll is in
        </p>
        <h2 className="font-display text-4xl font-bold text-white sm:text-6xl">
          {title}
        </h2>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 mx-auto max-w-7xl border-t border-white/8 px-5 py-8 text-xs leading-5 text-zinc-600 lg:px-8">
      <p>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      <a
        className="mt-1 inline-block text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noreferrer"
      >
        TMDB
      </a>
    </footer>
  );
}
