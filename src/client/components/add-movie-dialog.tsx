import { useId, useRef, useState } from "react";
import { LoaderCircle, Plus, Search, X } from "lucide-react";
import { api, ApiError, type TmdbResult } from "../api";
import type { RunAction } from "../types";
import { cn, formatDate } from "../lib/utils";
import { Dialog } from "./dialog";
import { Poster } from "./poster";
import { Button, Input } from "./ui";

export function AddMovieDialog({
  busy,
  onAuthExpired,
  onClose,
  run,
}: {
  busy: boolean;
  onAuthExpired: () => Promise<void>;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState("");
  const [franchiseName, setFranchiseName] = useState("");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [selected, setSelected] = useState<TmdbResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const titleId = useId();
  const franchiseId = useId();

  const search = async () => {
    if (!title.trim()) return;
    setSearching(true);
    setSearchError(null);

    try {
      setResults((await api.tmdbSearch(title)).results);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await onAuthExpired();
      }
      setSearchError(
        cause instanceof ApiError && cause.status === 401
          ? "Your session ended. Sign in again to search TMDB."
          : cause instanceof Error
            ? cause.message
            : "TMDB search failed",
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <Dialog
      describedBy={dialogDescriptionId}
      initialFocus={titleInputRef}
      labelledBy={dialogTitleId}
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="font-display text-2xl font-bold text-cream"
            id={dialogTitleId}
          >
            Add a movie
          </h2>
          <p
            className="mt-2 text-sm leading-6 text-zinc-400"
            id={dialogDescriptionId}
          >
            Search TMDB to confirm the title, or add it without a match.
          </p>
        </div>
        <Button aria-label="Close add movie" onClick={onClose} variant="ghost">
          <X size={18} />
        </Button>
      </div>

      <div className="mt-6 grid gap-4">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={titleId}>
            Movie title
          </label>
          <Input
            id={titleId}
            ref={titleInputRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setSelected(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="Movie title"
          />
          <Button
            aria-label="Search TMDB"
            className="shrink-0 px-3 sm:px-4"
            onClick={() => void search()}
            disabled={searching || !title.trim()}
          >
            {searching ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            <span className="hidden sm:inline">Search TMDB</span>
          </Button>
        </div>
        <label className="sr-only" htmlFor={franchiseId}>
          Series or franchise (optional)
        </label>
        <Input
          id={franchiseId}
          value={franchiseName}
          onChange={(event) => setFranchiseName(event.target.value)}
          placeholder="Series / franchise (optional)"
        />
      </div>

      {searchError && (
        <p className="mt-4 text-sm text-red-200" role="alert">
          {searchError}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-5 grid max-h-[40vh] gap-3 overflow-y-auto sm:grid-cols-2">
          {results.map((result) => (
            <button
              key={result.id}
              aria-pressed={selected?.id === result.id}
              onClick={() => {
                setSelected(result);
                setTitle(result.title);
              }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-3 text-left transition",
                selected?.id === result.id
                  ? "border-marquee-gold bg-curtain/30"
                  : "border-marquee-gold/10 bg-black/15 hover:border-marquee-gold/30",
              )}
            >
              <Poster path={result.posterPath} title={result.title} />
              <span>
                <span className="block font-semibold text-cream">
                  {result.title}
                </span>
                <span className="mt-1 block text-xs text-zinc-500">
                  {result.releaseDate
                    ? formatDate(result.releaseDate)
                    : "Release date unknown"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {title && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-curtain/35 pt-5">
          <p className="text-sm text-zinc-400">
            {selected
              ? `Confirmed: ${selected.title}`
              : "You can add this title without a TMDB match."}
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  api.addMovie({
                    title,
                    franchiseName,
                    tmdbId: selected?.id,
                  }),
                onClose,
              )
            }
          >
            <Plus size={16} />
            Add movie
          </Button>
        </div>
      )}
    </Dialog>
  );
}
