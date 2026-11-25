import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import {
  COLLECTION_LIMIT_MESSAGE,
  MAX_COLLECTION_TITLES,
} from "../../shared/collection-limits";
import { api, type AuditAttribution, type Movie } from "../api";
import { cn, formatMovieTitle } from "../lib/utils";
import type { Navigate, ReturnTarget, RunAction } from "../types";
import { AppLink } from "./app-link";
import { AuditDetails } from "./audit-details";
import { Button } from "./ui/button";
import { Link } from "./ui/link";

type CollectionDetailPageProps = {
  busy: boolean;
  audit?: {
    created: AuditAttribution;
    updated: AuditAttribution;
  };
  canMutate: boolean;
  collectionId: string;
  movies: Movie[];
  onLogin: () => void;
  onNavigate: Navigate;
  returnTo: ReturnTarget;
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

const returnLinks = {
  "now-showing": { href: "/", label: "Return to Now Showing" },
  "manager-office": {
    href: "/manager-office",
    label: "Return to Manager's Office",
  },
  library: { href: "/library", label: "Library" },
} satisfies Record<ReturnTarget, { href: string; label: string }>;

export function CollectionDetailPage({
  audit,
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
  const exceedsLimit = members.length > MAX_COLLECTION_TITLES;
  const [draft, setDraft] = useState(members);
  const [saved, setSaved] = useState(false);
  const { href: returnHref, label: returnLabel } = returnLinks[returnTo];
  const returnQuery = returnTo === "library" ? "" : `?from=${returnTo}`;

  if (members.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="font-heading text-4xl font-medium tracking-tight text-text-primary">
          Collection Not Found
        </h1>
        <p className="mt-3 text-text-muted">
          This collection is not in the catalog.
        </p>
        <AppLink
          className="mt-7"
          size="sm"
          withIcon
          variant="accent"
          href={returnHref}
          onNavigate={onNavigate}
        >
          <ArrowLeft size={16} />
          {returnTo === "library" ? "Return to the Library" : returnLabel}
        </AppLink>
      </div>
    );
  }

  const collectionName = members[0].collection_name ?? "Collection";
  const orderLocked = busy || exceedsLimit;
  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    setDraft(next);
    setSaved(false);
  };

  return (
    <div className="w-full">
      <AppLink
        className="mb-6"
        variant="muted"
        href={returnHref}
        onNavigate={onNavigate}
      >
        <ArrowLeft size={16} />
        {returnLabel}
      </AppLink>

      <CollectionHeading name={collectionName} members={members} />

      {canMutate && audit && (
        <AuditDetails
          className="mb-8"
          entries={[
            { attribution: audit.created, label: "Created" },
            { attribution: audit.updated, label: "Last updated" },
          ]}
        />
      )}

      <section
        aria-labelledby="collection-order-title"
        className="surface-panel overflow-hidden rounded-sm border"
      >
        <header className="border-b border-highlight/15 bg-action/10 px-5 py-4">
          <h2
            className="font-heading text-xl font-medium text-text-primary"
            id="collection-order-title"
          >
            Collection Order
          </h2>
          {!members[0]?.collection_order_confirmed && (
            <p className="mt-1.5 text-sm text-text-muted">
              Using date added until you save a custom order.
            </p>
          )}
        </header>
        {exceedsLimit && canMutate && (
          <p className="px-5 py-4 text-sm text-text-muted" role="status">
            {COLLECTION_LIMIT_MESSAGE} Move or remove titles before saving an
            order.
          </p>
        )}
        <ol className="data-surface">
          {draft.map((movie, index) => {
            const watched = movie.rating_score !== null;
            const title = formatMovieTitle(movie.title, movie.version);
            return (
              <li
                className="grid min-h-[78px] grid-cols-[52px_minmax(0,1fr)_auto] items-stretch border-b border-border-subtle bg-canvas/30 transition last:border-b-0 hover:bg-action/15 sm:grid-cols-[58px_minmax(0,1fr)_96px_92px]"
                key={movie.id}
              >
                <span className="grid place-items-center border-r border-border-subtle text-sm font-medium text-highlight-soft tabular-nums">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-col justify-center px-4 py-3 sm:px-5">
                  <AppLink
                    variant="title"
                    href={`/movies/${encodeURIComponent(movie.id)}${returnQuery}`}
                    onNavigate={onNavigate}
                  >
                    {title}
                  </AppLink>
                  {watched && movie.rating_phrase && (
                    <p className="mt-1 truncate text-xs text-text-muted">
                      {movie.rating_score} · {movie.rating_phrase}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "ui-label self-center text-text-muted max-sm:col-start-3 max-sm:row-start-1 max-sm:self-end max-sm:justify-self-end max-sm:pr-3 max-sm:pb-3",
                    watched && "text-highlight-soft",
                  )}
                >
                  {watched ? "Watched" : "Unwatched"}
                </span>
                {canMutate && (
                  <div className="flex shrink-0 items-center justify-end gap-1.5 pr-3 max-sm:col-start-3 max-sm:row-start-1 max-sm:self-start max-sm:pt-3">
                    <Button
                      aria-label={`Move ${title} Up`}
                      disabled={orderLocked || index === 0}
                      onClick={() => move(index, -1)}
                      size="icon"
                      variant="secondary"
                    >
                      <ArrowUp size={16} />
                    </Button>
                    <Button
                      aria-label={`Move ${title} Down`}
                      disabled={orderLocked || index === draft.length - 1}
                      onClick={() => move(index, 1)}
                      size="icon"
                      variant="secondary"
                    >
                      <ArrowDown size={16} />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-action/40 bg-action/10 px-5 py-4">
          {saved && (
            <p className="mr-auto text-sm text-success" role="status">
              Order saved.
            </p>
          )}
          {canMutate ? (
            <Button
              disabled={orderLocked}
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
              Save Order
            </Button>
          ) : (
            <Button onClick={onLogin} variant="secondary">
              Sign In to Set the Order
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}

function CollectionHeading({
  members,
  name,
}: {
  members: Movie[];
  name: string;
}) {
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
  return (
    <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
      <div>
        <h1 className="font-heading text-5xl leading-display-tight font-medium tracking-display-tight text-text-primary sm:text-7xl">
          {name}
        </h1>
        <p className="mt-4 text-sm text-text-muted">
          {members.length} {members.length === 1 ? "movie" : "movies"}
        </p>
      </div>
      {tmdbCollections.length > 0 && (
        <div className="grid max-w-sm gap-2 border-l border-border-subtle pl-5 text-sm">
          <span className="ui-label text-text-muted">
            {tmdbCollections.length === 1
              ? "Related TMDB Collection"
              : "Related TMDB Collections"}
          </span>
          {tmdbCollections.map((tmdbCollection) => (
            <Link
              withIcon
              variant="accent"
              href={`https://www.themoviedb.org/collection/${tmdbCollection.id}`}
              key={tmdbCollection.id}
              rel="noreferrer"
              target="_blank"
            >
              {tmdbCollection.name}
              <ExternalLink size={13} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
