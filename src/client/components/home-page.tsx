import { useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowDown, LoaderCircle, RotateCw } from "lucide-react";
import { api, type Movie, type NowShowing } from "../api";
import type { Navigate, RunAction } from "../types";
import { selectWatchedHistory } from "../lib/watched-history";
import { formatDate, formatMovieTitle, formatRuntime } from "../lib/utils";
import { AppLink } from "./app-link";
import { Badge, Button, Card, Input } from "./ui";
import { Poster } from "./poster";
import { RatingSlider } from "./rating-slider";

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
  const collectionId = nowShowing?.collection_id;
  const collectionHref = collectionId
    ? `/collections/${encodeURIComponent(collectionId)}?from=now-showing`
    : null;

  const releaseYear = nowShowing?.release_date?.slice(0, 4) ?? null;
  const currentMovie = nowShowing?.movie_id
    ? movies.find((movie) => movie.id === nowShowing.movie_id)
    : null;
  const runtime = currentMovie
    ? (currentMovie.version_runtime ?? currentMovie.runtime_minutes)
    : null;
  const nowShowingTitle = formatMovieTitle(
    nowShowing?.title,
    nowShowing?.version,
  );
  const titleLength = Math.max(nowShowingTitle.length, 12);

  return (
    <div className="space-y-14">
      <section aria-labelledby="now-showing-title">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-[clamp(42px,6vw,96px)]">
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
                className="feature-title font-heading font-medium tracking-[-0.045em] text-text-primary"
                id="now-showing-title"
                style={
                  {
                    "--movie-title-length": titleLength,
                    "--movie-title-size": `${360 / titleLength}cqi`,
                  } as CSSProperties
                }
              >
                {nowShowing?.movie_id ? (
                  <AppLink
                    aria-label={`${nowShowingTitle}${releaseYear ? ` (${releaseYear})` : ""}`}
                    className="transition hover:text-highlight-soft"
                    href={`/movies/${encodeURIComponent(nowShowing.movie_id)}?from=now-showing`}
                    onNavigate={onNavigate}
                  >
                    {nowShowingTitle}
                  </AppLink>
                ) : (
                  "No Movie Selected"
                )}
              </h1>
            </div>

            {hasSelection && (
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
                {currentMovie && (
                  <div>
                    <dt className="ui-label text-text-muted">Added</dt>
                    <dd className="metadata-value mt-2 text-text-secondary">
                      {formatDate(currentMovie.added_at)}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {hasSelection && (
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
                  href={`/movies/${encodeURIComponent(nowShowing!.movie_id!)}?from=now-showing`}
                  onNavigate={onNavigate}
                >
                  Movie Details →
                </AppLink>
              </div>
            )}

            {isWatched && nowShowing?.rating_score !== null && (
              <div
                aria-label={`Rating: ${nowShowing.rating_score} ${nowShowing.rating_phrase ?? ""}`}
                className="rating-surface mt-7 flex w-full max-w-sm items-baseline gap-4 border px-5 py-4"
              >
                <strong className="text-2xl font-semibold text-highlight-soft">
                  {nowShowing.rating_score}
                </strong>
                <span className="text-sm italic text-text-primary">
                  {nowShowing.rating_phrase}
                </span>
              </div>
            )}

            {canMutate && nowShowing?.movie_id && !isWatched ? (
              <RatingForm busy={busy} movieId={nowShowing.movie_id} run={run} />
            ) : canMutate ? (
              <div className="mt-7 flex flex-wrap gap-3">
                {isWatched && collectionId && hasNext && (
                  <Button
                    onClick={() => void run(() => api.next())}
                    disabled={busy}
                  >
                    <ArrowDown size={16} />
                    Continue Collection
                  </Button>
                )}
                <Button
                  onClick={roll}
                  disabled={busy}
                  variant={
                    isWatched && collectionId && hasNext
                      ? "secondary"
                      : "primary"
                  }
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <RotateCw size={16} />
                  )}
                  {isWatched && collectionId && hasNext
                    ? "Choose Another Movie"
                    : hasSelection
                      ? "Choose the Next Movie"
                      : "Choose a Movie"}
                </Button>
              </div>
            ) : (
              <div className="mt-7">
                <Button onClick={onLogin} variant="secondary">
                  {isWatched || !hasSelection
                    ? "Sign In to Choose What’s Next"
                    : "Sign In to Rate This Movie"}
                </Button>
              </div>
            )}
          </div>
        </div>
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
  const [score, setScore] = useState(2.5);
  const [phrase, setPhrase] = useState("");
  const [attempted, setAttempted] = useState(false);
  const phraseId = useId();
  const phraseErrorId = useId();
  const scoreId = useId();
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
      <div className="border-b border-highlight/15 p-4 sm:col-span-2 lg:col-span-1 lg:border-b-0 lg:border-r">
        <RatingSlider
          disabled={busy}
          id={scoreId}
          onChange={setScore}
          value={score}
        />
      </div>
      <div className="flex flex-col justify-center border-b border-highlight/15 p-4 sm:border-b-0 sm:border-r">
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
      <Button className="min-h-16 rounded-none" type="submit" disabled={busy}>
        Rate It
      </Button>
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
        className="mb-5 font-heading text-2xl font-medium tracking-tight text-text-primary sm:text-3xl"
        id="watched-movies-title"
      >
        Watched Movies
      </h2>
      {watchedMovies.length > 0 ? (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {watchedMovies.map((movie) => (
            <HistoryCard key={movie.id} movie={movie} onNavigate={onNavigate} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-sm text-text-muted">
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
  const title = formatMovieTitle(movie.title, movie.version);
  return (
    <AppLink
      aria-label={`View details for ${title}`}
      className="block h-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      href={`/movies/${encodeURIComponent(movie.id)}?from=now-showing`}
      onNavigate={onNavigate}
    >
      <Card className="h-full overflow-hidden p-4 transition hover:border-highlight/35 hover:bg-surface-interactive/55">
        <div className="flex items-start gap-4">
          <div className="w-[72px] shrink-0">
            <Poster path={movie.poster_path} title={title} />
          </div>
          <div className="min-w-0 pt-1">
            <h3 className="font-heading text-lg font-semibold leading-tight text-text-primary">
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
