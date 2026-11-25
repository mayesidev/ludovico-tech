import { ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { imdbTitleUrl } from "../../shared/imdb";
import type { Movie, MovieDetail } from "../api";
import { formatDate, formatMovieTitle, formatRuntime } from "../lib/utils";
import type { ReturnTarget } from "../types";
import { AppLink } from "./app-link";
import { AuditDetails } from "./audit-details";
import { Poster } from "./poster";
import { Button } from "./ui/button";

type MovieDetailPageProps = {
  canMutate?: boolean;
  movie: MovieDetail | null;
  onDelete?: (movie: Movie) => void;
  onEdit?: (movie: Movie) => void;
  onNavigate: (path: string) => void;
  returnTo: ReturnTarget;
};

export function MovieDetailPage({
  canMutate = false,
  movie,
  onDelete,
  onEdit,
  onNavigate,
  returnTo,
}: MovieDetailPageProps) {
  const returnHref =
    returnTo === "now-showing"
      ? "/"
      : returnTo === "manager-office"
        ? "/manager-office"
        : "/library";
  const returnLabel =
    returnTo === "now-showing"
      ? "Return to Now Showing"
      : returnTo === "manager-office"
        ? "Return to Manager's Office"
        : "Return to Library";
  const returnQuery = returnTo === "library" ? "" : `?from=${returnTo}`;

  if (!movie) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="font-heading text-4xl font-medium tracking-tight text-text-primary">
          Movie Not Found
        </h1>
        <p className="mt-3 text-text-muted">
          This movie is not in the catalog.
        </p>
        <AppLink
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-highlight-soft hover:text-text-primary"
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
  const title = formatMovieTitle(movie.title, movie.version);

  return (
    <div className="w-full">
      <AppLink
        className="ui-label mb-6 inline-flex items-center gap-2 text-text-muted hover:text-highlight-soft"
        href={returnHref}
        onNavigate={onNavigate}
      >
        <ArrowLeft size={16} />
        {returnLabel}
      </AppLink>

      <article className="mt-5 grid items-start gap-10 sm:grid-cols-[minmax(220px,286px)_minmax(0,1fr)] lg:gap-movie-detail">
        <div className="mx-auto w-full max-w-[286px]">
          <Poster path={movie.poster_path} title={title} large />
        </div>
        <div className="min-w-0 pt-2">
          <div className="grid gap-5 border-b border-border-subtle pb-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <h1 className="font-heading text-5xl leading-display-tight font-medium tracking-display-tight text-text-primary sm:text-6xl">
              {title}
            </h1>
            {watched && movie.rating_phrase !== null && (
              <div
                aria-label={`Rating: ${movie.rating_score} ${movie.rating_phrase}`}
                className="rating-surface flex min-w-0 items-baseline gap-3 border px-4 py-3 sm:max-w-64 sm:justify-self-end"
              >
                <span className="text-2xl font-semibold text-highlight-soft">
                  {movie.rating_score}
                </span>
                <span className="min-w-0 text-sm text-text-primary italic">
                  {movie.rating_phrase}
                </span>
              </div>
            )}
          </div>

          <MovieMetadata
            movie={movie}
            onNavigate={onNavigate}
            returnQuery={returnQuery}
          />

          <MovieActions
            canMutate={canMutate}
            movie={movie}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </article>
    </div>
  );
}

function MovieMetadata({
  movie,
  onNavigate,
  returnQuery,
}: {
  movie: MovieDetail;
  onNavigate: (path: string) => void;
  returnQuery: string;
}) {
  const runtime = movie.version_runtime ?? movie.runtime_minutes;
  return (
    <dl className="movie-metadata">
      {movie.release_date && (
        <div>
          <dt className="ui-label text-text-muted">Release date</dt>
          <dd className="text-text-secondary">
            {formatDate(movie.release_date)}
          </dd>
        </div>
      )}
      {movie.version && (
        <div>
          <dt className="ui-label text-text-muted">Version</dt>
          <dd className="text-text-secondary">
            {movie.version_reference_url ? (
              <a
                className="inline-flex items-center gap-1.5 font-semibold text-highlight-soft hover:text-text-primary"
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
          <dt className="ui-label text-text-muted">Runtime</dt>
          <dd className="text-text-secondary">{formatRuntime(runtime)}</dd>
        </div>
      )}
      {movie.directors.length > 0 && (
        <div>
          <dt className="ui-label text-text-muted">Directed by</dt>
          <dd className="text-text-secondary">
            {movie.directors.map((person) => person.name).join(", ")}
          </dd>
        </div>
      )}
      {movie.cast.length > 0 && (
        <div>
          <dt className="ui-label text-text-muted">Starring</dt>
          <dd className="text-text-secondary">
            {movie.cast.map((person) => person.name).join(", ")}
          </dd>
        </div>
      )}
      <div>
        <dt className="ui-label text-text-muted">Date added</dt>
        <dd className="text-text-secondary">{formatDate(movie.added_at)}</dd>
      </div>
      {movie.collection_name && movie.collection_id && (
        <div>
          <dt className="ui-label text-text-muted">Collection</dt>
          <dd>
            <AppLink
              className="font-semibold text-highlight-soft hover:text-text-primary"
              href={`/collections/${encodeURIComponent(movie.collection_id)}${returnQuery}`}
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
            <dt className="ui-label text-text-muted">TMDB collection</dt>
            <dd>
              <a
                className="inline-flex items-center gap-1.5 font-semibold text-highlight-soft hover:text-text-primary"
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
  );
}

function MovieActions({
  canMutate,
  movie,
  onDelete,
  onEdit,
}: Pick<MovieDetailPageProps, "onDelete" | "onEdit"> & {
  canMutate: boolean;
  movie: MovieDetail;
}) {
  const watched = movie.rating_score !== null;
  const edit = canMutate ? onEdit : undefined;
  const remove = canMutate && !watched ? onDelete : undefined;
  const audit = canMutate ? movie.audit : undefined;
  const hasExternalLinks = movie.tmdb_id !== null || movie.imdb_id !== null;
  const hasActions = Boolean(edit || remove);
  if (!hasExternalLinks && !hasActions && !audit) return null;

  return (
    <div className="mt-6 space-y-4">
      {hasExternalLinks && (
        <MovieProviders tmdbId={movie.tmdb_id} imdbId={movie.imdb_id} />
      )}
      {(hasActions || audit) && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          {audit && (
            <AuditDetails
              entries={movieAuditEntries(
                audit,
                watched,
                movie.tmdb_id !== null,
              )}
            />
          )}
          {hasActions && (
            <MovieActionButtons movie={movie} onEdit={edit} onDelete={remove} />
          )}
        </div>
      )}
    </div>
  );
}

function MovieActionButtons({
  movie,
  onDelete,
  onEdit,
}: Pick<MovieDetailPageProps, "onDelete" | "onEdit"> & { movie: Movie }) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {onEdit && (
        <Button onClick={() => onEdit(movie)} variant="secondary">
          <Pencil size={15} />
          Edit Movie
        </Button>
      )}
      {onDelete && (
        <Button onClick={() => onDelete(movie)} variant="danger">
          <Trash2 size={15} />
          Delete Movie
        </Button>
      )}
    </div>
  );
}

const movieAuditEntries = (
  audit: NonNullable<MovieDetail["audit"]>,
  watched: boolean,
  hasTmdb: boolean,
) => {
  const entries = [
    { attribution: audit.added, label: "Added" },
    { attribution: audit.updated, label: "Last updated" },
  ];
  if (watched)
    entries.push({ attribution: audit.rating, label: "Rating recorded" });
  if (hasTmdb)
    entries.push({ attribution: audit.metadata, label: "Metadata updated" });
  return entries;
};

function MovieProviders({
  imdbId,
  tmdbId,
}: {
  imdbId: string | null;
  tmdbId: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {tmdbId !== null && (
        <a
          className="inline-flex items-center gap-2 text-sm font-semibold text-highlight-soft hover:text-text-primary"
          href={`https://www.themoviedb.org/movie/${tmdbId}`}
          rel="noreferrer"
          target="_blank"
        >
          View on TMDB
          <ExternalLink size={15} />
        </a>
      )}
      {imdbId !== null && (
        <a
          className="inline-flex items-center gap-2 text-sm font-semibold text-highlight-soft hover:text-text-primary"
          href={imdbTitleUrl(imdbId)}
          rel="noreferrer"
          target="_blank"
        >
          View on IMDb
          <ExternalLink size={15} />
        </a>
      )}
    </div>
  );
}
