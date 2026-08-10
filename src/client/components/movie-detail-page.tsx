import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Movie } from "../api";
import { formatDate } from "../lib/utils";
import { AppLink } from "./app-link";
import { Poster } from "./poster";
import { Badge, Card } from "./ui";

type MovieDetailPageProps = {
  movie: Movie | null;
  onNavigate: (path: string) => void;
};

export function MovieDetailPage({ movie, onNavigate }: MovieDetailPageProps) {
  if (!movie) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="font-display text-4xl font-bold text-cream">
          Movie not found
        </h1>
        <p className="mt-3 text-zinc-400">This movie is not in the catalog.</p>
        <AppLink
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-marquee-light hover:text-cream"
          href="/library"
          onNavigate={onNavigate}
        >
          <ArrowLeft size={16} />
          Return to the library
        </AppLink>
      </div>
    );
  }

  const watched = movie.rating_score !== null;

  return (
    <div className="mx-auto max-w-4xl">
      <AppLink
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-marquee-light"
        href="/library"
        onNavigate={onNavigate}
      >
        <ArrowLeft size={16} />
        Library
      </AppLink>

      <Card className="grid gap-8 p-6 sm:grid-cols-[220px_1fr] sm:p-8 lg:p-10">
        <Poster path={movie.poster_path} title={movie.title} large />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{watched ? "Watched" : "Unwatched"}</Badge>
            {movie.release_date && (
              <span className="text-sm text-zinc-500">
                {formatDate(movie.release_date)}
              </span>
            )}
          </div>

          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-cream sm:text-5xl">
            {movie.title}
          </h1>

          {movie.franchise_name && movie.franchise_id && (
            <AppLink
              className="mt-4 inline-flex text-sm font-semibold text-marquee-light hover:text-cream"
              href={`/franchises/${encodeURIComponent(movie.franchise_id)}`}
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
