import { type RefObject, useId, useState } from "react";
import { Check, LoaderCircle, Search, Unlink } from "lucide-react";
import { api, ApiError, type TmdbResult } from "../api";
import { cn, formatDate } from "../lib/utils";
import { parseTmdbId } from "../lib/tmdb-id";
import { Poster } from "./poster";
import { Button, Input } from "./ui";

type TmdbMovieFieldsProps = {
  onAuthExpired: () => Promise<void>;
  onTitleChange: (title: string) => void;
  onTmdbIdChange: (tmdbId: string) => void;
  title: string;
  titleErrorId?: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  titleInvalid?: boolean;
  tmdbId: string;
};

export function TmdbMovieFields({
  onAuthExpired,
  onTitleChange,
  onTmdbIdChange,
  title,
  titleErrorId,
  titleInputRef,
  titleInvalid = false,
  tmdbId,
}: TmdbMovieFieldsProps) {
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [selected, setSelected] = useState<TmdbResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [checkingId, setCheckingId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const tmdbIdId = useId();
  const parsedTmdbId = parseTmdbId(tmdbId);

  const reportError = async (cause: unknown, action: string) => {
    if (cause instanceof ApiError && cause.status === 401) {
      await onAuthExpired();
    }
    setError(
      cause instanceof ApiError && cause.status === 401
        ? `Your session ended. Sign in again to ${action}.`
        : cause instanceof Error
          ? cause.message
          : `Unable to ${action}`,
    );
  };

  const search = async () => {
    if (!title.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults((await api.tmdbSearch(title)).results);
    } catch (cause) {
      await reportError(cause, "search TMDB");
    } finally {
      setSearching(false);
    }
  };

  const checkId = async () => {
    if (parsedTmdbId === null || parsedTmdbId === undefined) return;
    setCheckingId(true);
    setError(null);
    try {
      const { movie } = await api.tmdbMovie(parsedTmdbId);
      setSelected(movie);
      setResults([]);
      onTitleChange(movie.title);
      onTmdbIdChange(String(movie.id));
    } catch (cause) {
      await reportError(cause, "check that TMDB ID");
    } finally {
      setCheckingId(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={titleId}>
          Movie title
        </label>
        <Input
          aria-describedby={titleInvalid ? titleErrorId : undefined}
          aria-invalid={titleInvalid}
          id={titleId}
          ref={titleInputRef}
          required
          value={title}
          onChange={(event) => {
            onTitleChange(event.target.value);
            onTmdbIdChange("");
            setSelected(null);
            setResults([]);
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
          type="button"
        >
          {searching ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Search size={16} />
          )}
          <span className="hidden sm:inline">Search TMDB</span>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="sr-only" htmlFor={tmdbIdId}>
          TMDB movie ID (optional)
        </label>
        <Input
          aria-describedby={
            parsedTmdbId === undefined ? `${tmdbIdId}-error` : undefined
          }
          aria-invalid={parsedTmdbId === undefined}
          id={tmdbIdId}
          inputMode="numeric"
          value={tmdbId}
          onChange={(event) => {
            onTmdbIdChange(event.target.value);
            setSelected(null);
          }}
          placeholder="TMDB movie ID (optional)"
        />
        <Button
          className="justify-center"
          disabled={
            checkingId || parsedTmdbId === null || parsedTmdbId === undefined
          }
          onClick={() => void checkId()}
          type="button"
          variant="secondary"
        >
          {checkingId ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Check size={16} />
          )}
          Check ID
        </Button>
      </div>
      {parsedTmdbId === undefined && (
        <p
          className="text-sm text-red-200"
          id={`${tmdbIdId}-error`}
          role="alert"
        >
          Enter a positive whole-number TMDB ID.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-200" role="alert">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="grid max-h-[40vh] gap-3 overflow-y-auto sm:grid-cols-2">
          {results.map((result) => (
            <button
              key={result.id}
              aria-pressed={selected?.id === result.id}
              onClick={() => {
                setSelected(result);
                onTitleChange(result.title);
                onTmdbIdChange(String(result.id));
              }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-3 text-left transition",
                selected?.id === result.id
                  ? "border-marquee-gold bg-curtain/30"
                  : "border-marquee-gold/10 bg-black/15 hover:border-marquee-gold/30",
              )}
              type="button"
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

      {parsedTmdbId !== null && parsedTmdbId !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
          <span>
            {selected
              ? `Confirmed: ${selected.title} (TMDB #${selected.id})`
              : `TMDB #${parsedTmdbId} will be checked when saved.`}
          </span>
          <Button
            onClick={() => {
              onTmdbIdChange("");
              setSelected(null);
            }}
            type="button"
            variant="ghost"
          >
            <Unlink size={15} />
            Remove match
          </Button>
        </div>
      )}
    </div>
  );
}
