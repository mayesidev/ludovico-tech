import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink } from "lucide-react";
import { api, type Movie } from "../api";
import type { Navigate, RunAction } from "../types";
import { AppLink } from "./app-link";
import { Badge, Button, Card } from "./ui";

type CollectionDetailPageProps = {
  busy: boolean;
  canMutate: boolean;
  collectionId: string;
  movies: Movie[];
  onLogin: () => void;
  onNavigate: Navigate;
  returnTo: "library" | "now-showing";
  run: RunAction;
};

const byCollectionOrder = (left: Movie, right: Movie) => {
  if (!left.collection_order_confirmed) {
    return (
      left.added_at.localeCompare(right.added_at) ||
      left.id.localeCompare(right.id)
    );
  }
  const leftPosition = left.collection_position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.collection_position ?? Number.MAX_SAFE_INTEGER;
  return leftPosition - rightPosition || left.title.localeCompare(right.title);
};

export function CollectionDetailPage({
  busy,
  canMutate,
  collectionId,
  movies,
  onLogin,
  onNavigate,
  returnTo,
  run,
}: CollectionDetailPageProps) {
  const members = useMemo(
    () =>
      movies
        .filter((movie) => movie.collection_id === collectionId)
        .sort(byCollectionOrder),
    [collectionId, movies],
  );
  const tmdbCollections = useMemo(() => {
    const references = new Map<number, string>();
    for (const movie of members) {
      if (
        movie.tmdb_collection_id != null &&
        movie.tmdb_collection_name != null
      ) {
        references.set(movie.tmdb_collection_id, movie.tmdb_collection_name);
      }
    }
    return [...references.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [members]);
  const [draft, setDraft] = useState(members);
  const [saved, setSaved] = useState(false);
  const returnHref = returnTo === "now-showing" ? "/" : "/library";
  const returnLabel =
    returnTo === "now-showing" ? "Return to Now Showing" : "Library";
  const notFoundReturnLabel =
    returnTo === "now-showing"
      ? "Return to Now Showing"
      : "Return to the library";

  if (members.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="font-display text-4xl font-bold text-cream">
          Collection not found
        </h1>
        <p className="mt-3 text-zinc-400">
          This collection is not in the catalog.
        </p>
        <AppLink
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
          href={returnHref}
          onNavigate={onNavigate}
        >
          <ArrowLeft size={16} />
          {notFoundReturnLabel}
        </AppLink>
      </div>
    );
  }

  const collectionName = members[0].collection_name ?? "Collection";
  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    setDraft(next);
    setSaved(false);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <AppLink
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-marquee-light"
        href={returnHref}
        onNavigate={onNavigate}
      >
        <ArrowLeft size={16} />
        {returnLabel}
      </AppLink>

      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-marquee-gold">
          Collection
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-normal text-cream sm:text-5xl">
          {collectionName}
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          {members.length} {members.length === 1 ? "movie" : "movies"}
        </p>
        {tmdbCollections.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-zinc-500">
              {tmdbCollections.length === 1
                ? "Related TMDB collection"
                : "Related TMDB collections"}
            </span>
            {tmdbCollections.map((tmdbCollection) => (
              <a
                className="inline-flex items-center gap-1.5 font-semibold text-marquee-light hover:text-cream"
                href={`https://www.themoviedb.org/collection/${tmdbCollection.id}`}
                key={tmdbCollection.id}
                rel="noreferrer"
                target="_blank"
              >
                {tmdbCollection.name}
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        )}
      </div>

      <Card className="p-5 sm:p-7">
        <p className="mb-5 text-sm text-zinc-500">
          {members[0]?.collection_order_confirmed
            ? "Using the saved collection order."
            : "Using date added until you save a custom order."}
        </p>
        <ol className="space-y-3">
          {draft.map((movie, index) => {
            const watched = movie.rating_score !== null;
            return (
              <li
                className="flex items-center gap-3 rounded-2xl border border-marquee-gold/10 bg-black/20 p-3 sm:gap-4"
                key={movie.id}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-curtain/30 text-xs font-bold text-marquee-light">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <AppLink
                    className="font-semibold text-cream hover:text-marquee-light"
                    href={`/movies/${encodeURIComponent(movie.id)}`}
                    onNavigate={onNavigate}
                  >
                    {movie.title}
                  </AppLink>
                  {watched && movie.rating_phrase && (
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {movie.rating_score} · {movie.rating_phrase}
                    </p>
                  )}
                </div>
                <Badge>{watched ? "Watched" : "Unwatched"}</Badge>
                {canMutate && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      aria-label={`Move ${movie.title} up`}
                      className="rounded-lg p-2 text-zinc-500 hover:bg-curtain/30 hover:text-marquee-light disabled:opacity-30"
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      aria-label={`Move ${movie.title} down`}
                      className="rounded-lg p-2 text-zinc-500 hover:bg-curtain/30 hover:text-marquee-light disabled:opacity-30"
                      disabled={busy || index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-curtain/35 pt-5">
          {saved && (
            <p className="mr-auto text-sm text-marquee-light" role="status">
              Order saved.
            </p>
          )}
          {canMutate ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api.order(
                      collectionId,
                      draft.map((movie) => movie.id),
                    ),
                  () => setSaved(true),
                )
              }
            >
              Save order
            </Button>
          ) : (
            <Button onClick={onLogin} variant="secondary">
              Sign in to set the order
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
