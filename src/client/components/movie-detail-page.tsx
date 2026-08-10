import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import type { Movie } from "../api";
import { formatDate, formatRuntime } from "../lib/utils";
import { AppLink } from "./app-link";
import { Poster } from "./poster";
import { Badge, Button, Card } from "./ui";

type MovieDetailPageProps = {
  canMutate?: boolean;
  movie: Movie | null;
  onEdit?: (movie: Movie) => void;
  onNavigate: (path: string) => void;
  returnTo: "library" | "now-showing";
};

export function MovieDetailPage({
  canMutate = false,
  movie,
  onEdit,
  onNavigate,
  returnTo,
}: MovieDetailPageProps) {
  const returnHref = returnTo === "now-showing" ? "/" : "/library";
  const returnLabel =
    returnTo === "now-showing" ? "Return to Now Showing" : "Return to Library";

  if (!movie) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="font-display text-4xl font-bold text-cream">
          Movie not found
        </h1>
        <p className="mt-3 text-zinc-400">This movie is not in the catalog.</p>
        <AppLink
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
          href={returnHref}
          onNavigate={onNavigate}
        >
          <ArrowLeft size={16} />
          {returnLabel}
        </AppLink>
      </div>
    );
  }

  const watched = movie.rating_score !== null;

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

      <Card className="grid gap-8 p-6 sm:grid-cols-[220px_1fr] sm:p-8 lg:p-10">
        <Poster path={movie.poster_path} title={movie.title} large />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge>{watched ? "Watched" : "Unwatched"}</Badge>
            {canMutate && onEdit && (
              <Button onClick={() => onEdit(movie)} variant="secondary">
                <Pencil size={15} />
                Edit movie
              </Button>
            )}
          </div>

          <h1 className="mt-5 font-display text-4xl font-bold tracking-normal text-cream sm:text-5xl">
            {movie.title}
          </h1>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            {movie.release_date && (
              <div>
                <dt className="text-zinc-500">Release date</dt>
                <dd className="mt-1 text-zinc-300">
                  {formatDate(movie.release_date)}
                </dd>
              </div>
            )}
            {movie.runtime_minutes !== null && (
              <div>
                <dt className="text-zinc-500">Runtime</dt>
                <dd className="mt-1 text-zinc-300">
                  {formatRuntime(movie.runtime_minutes)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-zinc-500">Date added</dt>
              <dd className="mt-1 text-zinc-300">
                {formatDate(movie.added_at)}
              </dd>
            </div>
          </dl>

          {movie.franchise_name && movie.franchise_id && (
            <AppLink
              className="mt-4 inline-flex text-sm font-semibold text-marquee-light hover:text-cream"
              href={`/franchises/${encodeURIComponent(movie.franchise_id)}${returnTo === "now-showing" ? "?from=now-showing" : ""}`}
              onNavigate={onNavigate}
            >
              {movie.franchise_name}
            </AppLink>
          )}

          {watched && (
            <div className="mt-8 border-l-2 border-marquee-gold/50 pl-5">
              <p className="text-2xl font-semibold text-marquee-light">
                {movie.rating_score}
              </p>
              <p className="mt-1 text-lg italic text-cream">
                “{movie.rating_phrase}”
              </p>
            </div>
          )}

          {movie.tmdb_id !== null && (
            <a
              className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
              href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`}
              rel="noreferrer"
              target="_blank"
            >
              View on TMDB
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}
