import { ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { Movie } from "../api";
import { imdbTitleUrl } from "../../shared/imdb";
import { formatDate, formatMovieTitle, formatRuntime } from "../lib/utils";
import { AppLink } from "./app-link";
import { Poster } from "./poster";
import { Button, Card } from "./ui";

type MovieDetailPageProps = {
  canMutate?: boolean;
  movie: Movie | null;
  onDelete?: (movie: Movie) => void;
  onEdit?: (movie: Movie) => void;
  onNavigate: (path: string) => void;
  returnTo: "library" | "now-showing";
};

export function MovieDetailPage({
  canMutate = false,
  movie,
  onDelete,
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
  const canEdit = canMutate && onEdit;
  const canDelete = canMutate && !watched && onDelete;
  const runtime = movie.version_runtime ?? movie.runtime_minutes;
  const title = formatMovieTitle(movie.title, movie.version);

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
        <Poster path={movie.poster_path} title={title} large />
        <div className="min-w-0">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <h1 className="font-display text-4xl font-bold tracking-normal text-cream sm:text-5xl">
              {title}
            </h1>
            {watched && movie.rating_phrase !== null && (
              <div
                aria-label={`Rating: ${movie.rating_score} ${movie.rating_phrase}`}
                className="flex min-w-0 items-baseline gap-3 border-marquee-gold/50 sm:max-w-64 sm:justify-self-end sm:border-l-2 sm:pl-5 sm:pt-1"
              >
                <span className="text-2xl font-semibold text-marquee-light">
                  {movie.rating_score}
                </span>
                <span className="min-w-0 text-lg italic text-cream">
                  {movie.rating_phrase}
                </span>
              </div>
            )}
          </div>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            {movie.release_date && (
              <div>
                <dt className="text-zinc-500">Release date</dt>
                <dd className="mt-1 text-zinc-300">
                  {formatDate(movie.release_date)}
                </dd>
              </div>
            )}
            {movie.version && (
              <div>
                <dt className="text-zinc-500">Version</dt>
                <dd className="mt-1 text-zinc-300">
                  {movie.version_reference_url ? (
                    <a
                      className="inline-flex items-center gap-1.5 font-semibold text-marquee-light hover:text-cream"
                      href={movie.version_reference_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {movie.version}
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    movie.version
                  )}
                </dd>
              </div>
            )}
            {runtime !== null && (
              <div>
                <dt className="text-zinc-500">Runtime</dt>
                <dd className="mt-1 text-zinc-300">{formatRuntime(runtime)}</dd>
              </div>
            )}
            <div>
              <dt className="text-zinc-500">Date added</dt>
              <dd className="mt-1 text-zinc-300">
                {formatDate(movie.added_at)}
              </dd>
            </div>
            {movie.collection_name && movie.collection_id && (
              <div>
                <dt className="text-zinc-500">Collection</dt>
                <dd className="mt-1">
                  <AppLink
                    className="font-semibold text-marquee-light hover:text-cream"
                    href={`/collections/${encodeURIComponent(movie.collection_id)}${returnTo === "now-showing" ? "?from=now-showing" : ""}`}
                    onNavigate={onNavigate}
                  >
                    {movie.collection_name}
                  </AppLink>
                </dd>
              </div>
            )}
            {movie.tmdb_collection_id != null &&
              movie.tmdb_collection_name != null && (
                <div>
                  <dt className="text-zinc-500">TMDB collection</dt>
                  <dd className="mt-1">
                    <a
                      className="inline-flex items-center gap-1.5 font-semibold text-marquee-light hover:text-cream"
                      href={`https://www.themoviedb.org/collection/${movie.tmdb_collection_id}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {movie.tmdb_collection_name}
                      <ExternalLink size={13} />
                    </a>
                  </dd>
                </div>
              )}
          </dl>

          {(movie.tmdb_id !== null ||
            movie.imdb_id !== null ||
            canEdit ||
            canDelete) && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              {(movie.tmdb_id !== null || movie.imdb_id !== null) && (
                <div className="flex flex-wrap items-center gap-4">
                  {movie.tmdb_id !== null && (
                    <a
                      className="inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
                      href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View on TMDB
                      <ExternalLink size={15} />
                    </a>
                  )}
                  {movie.imdb_id !== null && (
                    <a
                      className="inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
                      href={imdbTitleUrl(movie.imdb_id)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View on IMDb
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {canEdit && (
                  <Button onClick={() => onEdit(movie)} variant="secondary">
                    <Pencil size={15} />
                    Edit movie
                  </Button>
                )}
                {canDelete && (
                  <Button onClick={() => onDelete(movie)} variant="danger">
                    <Trash2 size={15} />
                    Delete movie
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
