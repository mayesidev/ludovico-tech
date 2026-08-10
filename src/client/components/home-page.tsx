import { useId, useMemo, useState } from "react";
import { ArrowDown, LoaderCircle, RotateCw, Star } from "lucide-react";
import { api, type Movie, type NowShowing } from "../api";
import type { Navigate, RunAction } from "../types";
import { cn } from "../lib/utils";
import { selectWatchedHistory } from "../lib/watched-history";
import { AppLink } from "./app-link";
import { Badge, Button, Card, Input } from "./ui";
import { Poster } from "./poster";

const scoreOptions = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

type HomePageProps = {
  nowShowing: NowShowing | null;
  remaining: Movie[];
  movies: Movie[];
  busy: boolean;
  canMutate: boolean;
  onLogin: () => void;
  onNavigate: Navigate;
  roll: () => void;
  run: RunAction;
};

export function HomePage({
  nowShowing,
  remaining,
  movies,
  busy,
  canMutate,
  onLogin,
  onNavigate,
  roll,
  run,
}: HomePageProps) {
  const isWatched =
    nowShowing?.rating_score !== null && nowShowing?.rating_score !== undefined;
  const hasNext = remaining.some((movie) => movie.rating_score === null);
  const hasSelection = Boolean(nowShowing?.movie_id);
  const unwatchedCount = movies.filter(
    (movie) => movie.rating_score === null,
  ).length;
  const franchiseId = nowShowing?.franchise_id;
  const franchiseHref = franchiseId
    ? `/franchises/${encodeURIComponent(franchiseId)}?from=now-showing`
    : null;

  const releaseYear = nowShowing?.release_date?.slice(0, 4) ?? null;

  return (
    <div className="space-y-14">
      <section aria-labelledby="now-showing-title">
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(216,172,76,0.14),transparent_32%),linear-gradient(120deg,rgba(120,23,41,0.12),transparent_55%)]" />
          <div className="relative p-6 text-center sm:p-8 lg:p-10">
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-marquee-gold">
                Now showing
              </p>
              <p className="text-xs text-zinc-500">
                {unwatchedCount} unwatched out of {movies.length} movies
              </p>
            </div>
            <h1
              className="mx-auto mt-5 max-w-3xl font-display text-4xl font-bold leading-none tracking-normal text-cream sm:text-6xl"
              id="now-showing-title"
            >
              {nowShowing?.movie_id ? (
                <AppLink
                  aria-label={`${nowShowing.title}${releaseYear ? ` (${releaseYear})` : ""}`}
                  className="transition hover:text-marquee-light"
                  href={`/movies/${encodeURIComponent(nowShowing.movie_id)}`}
                  onNavigate={onNavigate}
                >
                  {nowShowing.title}
                  {releaseYear && (
                    <span className="ml-2 whitespace-nowrap font-sans text-2xl font-medium text-zinc-400 sm:text-3xl">
                      ({releaseYear})
                    </span>
                  )}
                </AppLink>
              ) : (
                "No movie selected"
              )}
            </h1>
            {nowShowing?.franchise_name && franchiseHref && (
              <AppLink
                className="mt-4 inline-flex"
                href={franchiseHref}
                onNavigate={onNavigate}
              >
                <Badge>{nowShowing.franchise_name}</Badge>
              </AppLink>
            )}

            <div className="mx-auto mt-7 w-full max-w-[220px]">
              <Poster
                path={nowShowing?.poster_path}
                title={nowShowing?.title ?? "No movie selected"}
                large
              />
            </div>

            {nowShowing?.title && isWatched && (
              <p className="mt-4 text-sm text-zinc-500">Watched</p>
            )}
            {isWatched && nowShowing?.rating_score !== null && (
              <div className="mt-7 flex items-center justify-center gap-3">
                <span className="flex items-center gap-1 text-marquee-light">
                  <Star size={17} fill="currentColor" />
                  {nowShowing.rating_score}
                </span>
                <span className="text-sm italic text-zinc-400">
                  “{nowShowing.rating_phrase || "A rating without a tagline."}”
                </span>
              </div>
            )}

            {canMutate &&
            nowShowing?.movie_id &&
            !isWatched &&
            nowShowing.status !== "pending_order" ? (
              <RatingForm busy={busy} movieId={nowShowing.movie_id} run={run} />
            ) : canMutate ? (
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {nowShowing?.status === "pending_order" && franchiseHref && (
                  <Button
                    disabled={busy}
                    onClick={() => onNavigate(franchiseHref)}
                  >
                    Confirm franchise order
                  </Button>
                )}
                {isWatched && franchiseId && hasNext && (
                  <Button
                    onClick={() => void run(() => api.next())}
                    disabled={busy}
                  >
                    <ArrowDown size={16} />
                    Continue series
                  </Button>
                )}
                {nowShowing?.status !== "pending_order" && (
                  <Button onClick={roll} disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <RotateCw size={16} />
                    )}
                    {isWatched && franchiseId && hasNext
                      ? "Choose another movie"
                      : hasSelection
                        ? "Choose the next movie"
                        : "Choose a movie"}
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-8 text-center">
                {nowShowing?.status === "pending_order" && franchiseHref ? (
                  <Button
                    onClick={() => onNavigate(franchiseHref)}
                    variant="secondary"
                  >
                    Review franchise order
                  </Button>
                ) : (
                  <Button onClick={onLogin} variant="secondary">
                    {isWatched || !hasSelection
                      ? "Sign in to choose what’s next"
                      : "Sign in to rate this movie"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      </section>

      <HistorySection movies={movies} onNavigate={onNavigate} />
    </div>
  );
}

function RatingForm({
  busy,
  movieId,
  run,
}: {
  busy: boolean;
  movieId: string;
  run: RunAction;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [phrase, setPhrase] = useState("");
  const [attempted, setAttempted] = useState(false);
  const phraseId = useId();
  const phraseErrorId = useId();
  const scoreErrorId = useId();
  const scoreMissing = attempted && score === null;
  const phraseMissing = attempted && !phrase.trim();

  return (
    <form
      className="mx-auto mt-8 max-w-lg"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (score === null || !phrase.trim()) return;
        void run(
          () => api.rate(movieId, score, phrase.trim()),
          () => {
            setAttempted(false);
            setScore(null);
            setPhrase("");
          },
        );
      }}
    >
      <fieldset aria-describedby={scoreMissing ? scoreErrorId : undefined}>
        <legend className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Final rating (required)
        </legend>
        <div className="flex flex-wrap justify-center gap-2">
          {scoreOptions.map((option) => (
            <button
              type="button"
              aria-pressed={score === option}
              key={option}
              onClick={() => setScore(option)}
              className={cn(
                "grid size-10 place-items-center rounded-xl border text-sm font-bold transition",
                score === option
                  ? "border-marquee-light bg-marquee-gold text-ink"
                  : "border-marquee-gold/15 bg-black/20 text-zinc-300 hover:border-marquee-gold/50",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {scoreMissing && (
          <p
            className="mt-2 text-sm text-red-200"
            id={scoreErrorId}
            role="alert"
          >
            Choose a rating from 0 to 5.
          </p>
        )}
      </fieldset>
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <label className="sr-only" htmlFor={phraseId}>
            Custom rating phrase (required)
          </label>
          <Input
            aria-describedby={phraseMissing ? phraseErrorId : undefined}
            aria-invalid={phraseMissing}
            id={phraseId}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder="whats?"
            maxLength={120}
            required
          />
          {phraseMissing && (
            <p
              className="mt-2 text-sm text-red-200"
              id={phraseErrorId}
              role="alert"
            >
              Add the custom rating phrase.
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy}>
          Rate it
        </Button>
      </div>
    </form>
  );
}

function HistorySection({
  movies,
  onNavigate,
}: {
  movies: Movie[];
  onNavigate: Navigate;
}) {
  const watchedMovies = useMemo(() => selectWatchedHistory(movies), [movies]);

  return (
    <section aria-labelledby="watched-movies-title">
      <h2
        className="mb-5 font-display text-2xl font-bold tracking-normal text-cream sm:text-3xl"
        id="watched-movies-title"
      >
        Watched movies
      </h2>
      {watchedMovies.length > 0 ? (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {watchedMovies.map((movie) => (
            <HistoryCard key={movie.id} movie={movie} onNavigate={onNavigate} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-sm text-zinc-500">
          No movies have been rated yet.
        </Card>
      )}
    </section>
  );
}

function HistoryCard({
  movie,
  onNavigate,
}: {
  movie: Movie;
  onNavigate: Navigate;
}) {
  return (
    <AppLink
      aria-label={`View details for ${movie.title}`}
      className="block h-full rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marquee-light"
      href={`/movies/${encodeURIComponent(movie.id)}`}
      onNavigate={onNavigate}
    >
      <Card className="h-full overflow-hidden p-4 transition hover:border-marquee-gold/35 hover:bg-curtain/10">
        <div className="flex items-start gap-4">
          <div className="w-[72px] shrink-0">
            <Poster path={movie.poster_path} title={movie.title} />
          </div>
          <div className="min-w-0 pt-1">
            <h3 className="font-display text-lg font-bold leading-tight text-cream">
              {movie.title}
            </h3>
            {movie.rating_score !== null && (
              <p className="mt-3 text-sm leading-5 text-marquee-light">
                {movie.rating_score} · {movie.rating_phrase}
              </p>
            )}
          </div>
        </div>
      </Card>
    </AppLink>
  );
}
