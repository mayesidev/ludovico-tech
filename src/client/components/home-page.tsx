import { ArrowDown, LoaderCircle, RotateCw } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";
import { api, type HomeMovie, type NowShowing } from "../api";
import { cn, formatDate, formatMovieTitle, formatRuntime } from "../lib/utils";
import type { Navigate, RunAction } from "../types";
import { AppLink } from "./app-link";
import { AuditDetails } from "./audit-details";
import { Poster } from "./poster";
import { RatingSlider } from "./rating-slider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

type HomePageProps = {
  nowShowing: NowShowing | null;
  hasNextCollectionMovie: boolean;
  watchedMovies: HomeMovie[];
  busy: boolean;
  canMutate: boolean;
  onLogin: () => void;
  onNavigate: Navigate;
  roll: () => void;
  run: RunAction;
};

export function HomePage({
  nowShowing,
  hasNextCollectionMovie,
  watchedMovies,
  busy,
  canMutate,
  onLogin,
  onNavigate,
  roll,
  run,
}: HomePageProps) {
  const movieId = nowShowing?.movie_id;
  const collectionId = nowShowing?.collection_id;
  const collectionHref = collectionId
    ? `/collections/${encodeURIComponent(collectionId)}?from=now-showing`
    : null;

  const releaseYear = nowShowing?.release_date?.slice(0, 4) ?? null;
  const nowShowingTitle = formatMovieTitle(
    nowShowing?.title,
    nowShowing?.version,
  );
  const titleLength = Math.max(nowShowingTitle.length, 12);

  return (
    <div className="space-y-14">
      <section aria-labelledby="now-showing-title">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-feature-layout">
          <div className="mx-auto w-full max-w-[340px]">
            <Poster
              path={nowShowing?.poster_path}
              title={nowShowingTitle || "No movie selected"}
              large
            />
          </div>

          <div className="min-w-0 pt-1 sm:pt-4 lg:pt-10">
            <div className="feature-title-container w-full">
              <h1
                className="feature-title font-heading font-medium tracking-heading text-text-primary"
                id="now-showing-title"
                style={
                  {
                    "--movie-title-length": titleLength,
                    "--movie-title-size": `${360 / titleLength}cqi`,
                  } as CSSProperties
                }
              >
                {movieId ? (
                  <AppLink
                    aria-label={`${nowShowingTitle}${releaseYear ? ` (${releaseYear})` : ""}`}
                    className="transition hover:text-highlight-soft"
                    href={`/movies/${encodeURIComponent(movieId)}?from=now-showing`}
                    onNavigate={onNavigate}
                  >
                    {nowShowingTitle}
                  </AppLink>
                ) : (
                  "No Movie Selected"
                )}
              </h1>
            </div>

            {movieId && (
              <>
                <FeatureFacts movie={nowShowing} />
                <FeatureCredits movie={nowShowing} />
              </>
            )}

            {movieId && (
              <div className="flex w-full flex-wrap items-baseline justify-between gap-4 pt-5">
                {nowShowing?.collection_name && collectionHref ? (
                  <AppLink href={collectionHref} onNavigate={onNavigate}>
                    <Badge>{nowShowing.collection_name}</Badge>
                  </AppLink>
                ) : (
                  <span />
                )}
                <AppLink
                  className="ml-auto text-sm font-semibold tracking-normal text-highlight-soft hover:text-text-primary"
                  href={`/movies/${encodeURIComponent(movieId)}?from=now-showing`}
                  onNavigate={onNavigate}
                >
                  Movie Details →
                </AppLink>
              </div>
            )}

            {nowShowing?.rating_score != null && (
              <div
                aria-label={`Rating: ${nowShowing.rating_score} ${nowShowing.rating_phrase ?? ""}`}
                className="rating-surface mt-7 flex w-full max-w-sm items-baseline gap-4 border px-5 py-4"
              >
                <strong className="text-2xl font-semibold text-highlight-soft">
                  {nowShowing.rating_score}
                </strong>
                <span className="text-sm text-text-primary italic">
                  {nowShowing.rating_phrase}
                </span>
              </div>
            )}

            <FeatureActions
              busy={busy}
              canMutate={canMutate}
              hasNextCollectionMovie={hasNextCollectionMovie}
              nowShowing={nowShowing}
              onLogin={onLogin}
              roll={roll}
              run={run}
            />

            {canMutate && nowShowing?.audit && (
              <FeatureAudit audit={nowShowing.audit} />
            )}
          </div>
        </div>
      </section>

      <HistorySection movies={watchedMovies} onNavigate={onNavigate} />
    </div>
  );
}

function FeatureFacts({ movie }: { movie: NowShowing }) {
  const releaseYear = movie.release_date?.slice(0, 4) ?? null;
  const runtime = movie.version_runtime ?? movie.runtime_minutes ?? null;
  return (
    <dl className="feature-metadata">
      {releaseYear && (
        <div>
          <dt className="ui-label text-text-muted">Release</dt>
          <dd className="metadata-value mt-2 text-text-secondary">
            {releaseYear}
          </dd>
        </div>
      )}
      {runtime !== null && (
        <div>
          <dt className="ui-label text-text-muted">Runtime</dt>
          <dd className="metadata-value mt-2 text-text-secondary">
            {formatRuntime(runtime)}
          </dd>
        </div>
      )}
      {movie.added_at && (
        <div>
          <dt className="ui-label text-text-muted">Added</dt>
          <dd className="metadata-value mt-2 text-text-secondary">
            {formatDate(movie.added_at)}
          </dd>
        </div>
      )}
    </dl>
  );
}

function FeatureCredits({ movie }: { movie: NowShowing }) {
  const cast = movie.cast ?? [];
  const directors = movie.directors ?? [];
  if (!directors.length && !cast.length) return null;

  return (
    <dl
      className={cn(
        "feature-credits",
        (directors.length === 0 || cast.length === 0) &&
          "feature-credits-single",
      )}
    >
      {directors.length > 0 && (
        <div>
          <dt className="ui-label text-text-muted">Directed by</dt>
          <dd className="metadata-value mt-2 text-text-secondary">
            {directors.map((person) => person.name).join(", ")}
          </dd>
        </div>
      )}
      {cast.length > 0 && (
        <div>
          <dt className="ui-label text-text-muted">Starring</dt>
          <dd className="metadata-value mt-2 text-text-secondary">
            {cast.map((person) => person.name).join(", ")}
          </dd>
        </div>
      )}
    </dl>
  );
}

function FeatureActions({
  busy,
  canMutate,
  hasNextCollectionMovie,
  nowShowing,
  onLogin,
  roll,
  run,
}: Omit<HomePageProps, "onNavigate" | "watchedMovies">) {
  const movieId = nowShowing?.movie_id;
  const isWatched = nowShowing?.rating_score != null;
  if (!canMutate) {
    return (
      <div className="mt-7">
        <Button onClick={onLogin} variant="secondary">
          {isWatched || !movieId
            ? "Sign In to Roll What’s Next"
            : "Sign In to Rate This Movie"}
        </Button>
      </div>
    );
  }
  if (movieId && !isWatched) {
    return <RatingForm busy={busy} movieId={movieId} run={run} />;
  }

  const canContinue =
    isWatched && nowShowing?.collection_id && hasNextCollectionMovie;
  return (
    <div className="mt-7 flex flex-wrap gap-3">
      {canContinue && (
        <Button onClick={() => void run(() => api.next())} disabled={busy}>
          <ArrowDown size={16} />
          Continue Collection
        </Button>
      )}
      <Button
        onClick={roll}
        disabled={busy}
        variant={canContinue ? "secondary" : "primary"}
      >
        {busy ? (
          <LoaderCircle className="animate-spin" size={16} />
        ) : (
          <RotateCw size={16} />
        )}
        Roll What’s Next
      </Button>
    </div>
  );
}

function FeatureAudit({ audit }: { audit: NonNullable<NowShowing["audit"]> }) {
  return (
    <AuditDetails
      className="mt-6"
      entries={[
        {
          attribution: audit.rolled,
          label: "Rolled at",
        },
        ...(audit.movie
          ? [
              {
                attribution: audit.movie.added,
                label: "Movie added",
              },
              {
                attribution: audit.movie.updated,
                label: "Movie last updated",
              },
              {
                attribution: audit.movie.rating,
                label: "Rating recorded",
              },
              {
                attribution: audit.movie.metadata,
                label: "TMDB metadata updated",
              },
            ]
          : []),
      ]}
    />
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
  const [score, setScore] = useState(2.5);
  const [phrase, setPhrase] = useState("");
  const [attempted, setAttempted] = useState(false);
  const phraseId = useId();
  const phraseErrorId = useId();
  const phraseMissing = attempted && !phrase.trim();

  return (
    <form
      className="rating-surface mt-7 grid w-full border sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(230px,1.2fr)_minmax(180px,0.9fr)_auto]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!phrase.trim()) return;
        void run(
          () => api.rate(movieId, score, phrase.trim()),
          () => {
            setAttempted(false);
            setScore(2.5);
            setPhrase("");
          },
        );
      }}
    >
      <div className="border-b border-highlight/15 p-4 sm:col-span-2 lg:col-span-1 lg:border-r lg:border-b-0">
        <RatingSlider disabled={busy} onChange={setScore} value={score} />
      </div>
      <div className="flex flex-col justify-center border-b border-highlight/15 p-4 sm:border-r sm:border-b-0">
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
            className="mt-2 text-sm text-danger"
            id={phraseErrorId}
            role="alert"
          >
            Add the custom rating phrase.
          </p>
        )}
      </div>
      <Button variant="rating" type="submit" disabled={busy}>
        Rate It
      </Button>
    </form>
  );
}

function HistorySection({
  movies,
  onNavigate,
}: {
  movies: HomeMovie[];
  onNavigate: Navigate;
}) {
  return (
    <section aria-labelledby="watched-movies-title">
      <h2
        className="mb-5 font-heading text-2xl font-medium tracking-tight text-text-primary sm:text-3xl"
        id="watched-movies-title"
      >
        Watched Movies
      </h2>
      {movies.length > 0 ? (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {movies.map((movie) => (
            <HistoryCard key={movie.id} movie={movie} onNavigate={onNavigate} />
          ))}
        </div>
      ) : (
        <Card variant="empty">No movies have been rated yet.</Card>
      )}
    </section>
  );
}

function HistoryCard({
  movie,
  onNavigate,
}: {
  movie: HomeMovie;
  onNavigate: Navigate;
}) {
  const title = formatMovieTitle(movie.title, movie.version);
  return (
    <AppLink
      aria-label={`View details for ${title}`}
      className="block h-full rounded-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      href={`/movies/${encodeURIComponent(movie.id)}?from=now-showing`}
      onNavigate={onNavigate}
    >
      <Card className="h-full overflow-hidden" variant="interactive">
        <div className="flex items-start gap-4">
          <div className="w-[72px] shrink-0">
            <Poster path={movie.poster_path} title={title} />
          </div>
          <div className="min-w-0 pt-1">
            <h3 className="font-heading text-lg leading-tight font-semibold text-text-primary">
              {title}
            </h3>
            {movie.rating_score !== null && (
              <p className="mt-3 text-sm leading-5 text-highlight-soft">
                {movie.rating_score} · {movie.rating_phrase}
              </p>
            )}
          </div>
        </div>
      </Card>
    </AppLink>
  );
}
