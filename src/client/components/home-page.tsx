import { useState } from "react";
import {
  ArrowDown,
  LoaderCircle,
  Plus,
  RotateCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { api, type Movie, type NowShowing, type TmdbResult } from "../api";
import type { RunAction } from "../types";
import { cn, formatDate } from "../lib/utils";
import { Badge, Button, Card, Input, SectionHeading } from "./ui";
import { Poster } from "./poster";

const scoreOptions = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

type HomePageProps = {
  nowShowing: NowShowing | null;
  remaining: Movie[];
  movies: Movie[];
  busy: boolean;
  roll: () => void;
  run: RunAction;
  refresh: () => Promise<void>;
};

export function HomePage({
  nowShowing,
  remaining,
  movies,
  busy,
  roll,
  run,
  refresh,
}: HomePageProps) {
  const isWatched =
    nowShowing?.rating_score !== null && nowShowing?.rating_score !== undefined;
  const hasNext = remaining.some((movie) => movie.rating_score === null);
  const unwatchedCount = movies.filter(
    (movie) => movie.rating_score === null,
  ).length;
  const franchiseId = nowShowing?.franchise_id;

  return (
    <div className="space-y-16">
      <section className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-lime-300">
            <span className="size-2 rounded-full bg-lime-300 shadow-[0_0_18px] shadow-lime-300" />
            Weekly screening
          </p>
          <h1 className="max-w-3xl font-display text-5xl font-bold leading-[0.95] tracking-[-0.055em] text-white sm:text-7xl">
            What’s on the <span className="text-lime-300">marquee?</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-zinc-400">
            One shared list. One movie at a time. A little ceremony before the
            next screening.
          </p>
        </div>
        <div className="justify-self-end text-right">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">
            The collection
          </p>
          <p className="mt-1 font-display text-5xl font-bold text-white">
            {unwatchedCount || "—"}
          </p>
          <p className="text-sm text-zinc-500">movies in rotation</p>
        </div>
      </section>

      <section>
        <SectionHeading
          eyebrow="Now showing"
          title={nowShowing?.title ?? "The screen is waiting"}
          description={
            nowShowing?.franchise_name
              ? `${nowShowing.franchise_name} · choose your own order`
              : "Roll the list when the group is ready for something new."
          }
        />
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(190,242,100,0.12),transparent_32%),linear-gradient(120deg,rgba(255,255,255,0.02),transparent)]" />
          <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[220px_1fr] lg:p-10">
            <Poster
              path={nowShowing?.poster_path}
              title={nowShowing?.title ?? "Waiting for the next roll"}
              large
            />
            <div className="flex min-h-[300px] flex-col justify-between">
              <div>
                {nowShowing?.franchise_name && (
                  <Badge className="mb-5 border-lime-300/20 bg-lime-300/10 text-lime-200">
                    {nowShowing.franchise_name}
                  </Badge>
                )}
                {nowShowing?.title ? (
                  <>
                    <h3 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
                      {nowShowing.title}
                    </h3>
                    <p className="mt-3 text-sm text-zinc-500">
                      {formatDate(nowShowing.release_date)}
                      {isWatched && " · Watched"}
                    </p>
                  </>
                ) : (
                  <h3 className="max-w-md font-display text-4xl font-bold tracking-tight text-white">
                    Cue the drumroll.
                  </h3>
                )}
                {isWatched && nowShowing?.rating_score !== null && (
                  <div className="mt-7 flex items-center gap-3">
                    <span className="flex items-center gap-1 text-lime-300">
                      <Star size={17} fill="currentColor" />
                      {nowShowing.rating_score}/5
                    </span>
                    <span className="text-sm italic text-zinc-400">
                      “
                      {nowShowing.rating_phrase ||
                        "A rating without a tagline."}
                      ”
                    </span>
                  </div>
                )}
              </div>

              {nowShowing?.movie_id && !isWatched ? (
                <RatingForm movieId={nowShowing.movie_id} run={run} />
              ) : (
                <div className="mt-8 flex flex-wrap gap-3">
                  {isWatched && franchiseId && hasNext && (
                    <Button
                      onClick={() => void run(() => api.next())}
                      disabled={busy}
                    >
                      <ArrowDown size={16} />
                      Next movie
                    </Button>
                  )}
                  <Button onClick={roll} disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <RotateCw size={16} />
                    )}
                    {isWatched && franchiseId && hasNext
                      ? "Roll something new"
                      : "Roll next"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>

      <HistorySection movies={movies} />
      <AddMovieSection run={run} refresh={refresh} />
    </div>
  );
}

function RatingForm({ movieId, run }: { movieId: string; run: RunAction }) {
  const [score, setScore] = useState<number | null>(null);
  const [phrase, setPhrase] = useState("");

  return (
    <form
      className="mt-8 max-w-lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (score === null) return;
        void run(
          () => api.rate(movieId, score, phrase),
          () => {
            setScore(null);
            setPhrase("");
          },
        );
      }}
    >
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
        Final rating
      </p>
      <div className="flex flex-wrap gap-2">
        {scoreOptions.map((option) => (
          <button
            type="button"
            key={option}
            onClick={() => setScore(option)}
            className={cn(
              "grid size-10 place-items-center rounded-xl border text-sm font-bold transition",
              score === option
                ? "border-lime-300 bg-lime-300 text-zinc-950"
                : "border-white/10 bg-white/5 text-zinc-300 hover:border-lime-300/50",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="Give it a goofy phrase…"
          maxLength={120}
        />
        <Button type="submit" disabled={score === null}>
          Rate it
        </Button>
      </div>
    </form>
  );
}

function HistorySection({ movies }: { movies: Movie[] }) {
  const watchedMovies = movies
    .filter((movie) => movie.rating_score !== null)
    .sort((a, b) => (b.watched_at ?? "").localeCompare(a.watched_at ?? ""));

  return (
    <section>
      <SectionHeading
        eyebrow="Recently viewed"
        title="A little history"
        description="The movies that have already made it through the program."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {watchedMovies.slice(0, 4).map((movie, index) => (
          <HistoryCard key={movie.id} movie={movie} index={index} />
        ))}
        {watchedMovies.length === 0 &&
          [...Array(4)].map((_, index) => (
            <HistoryCard key={`empty-${index}`} movie={null} index={index} />
          ))}
      </div>
    </section>
  );
}

function HistoryCard({ movie, index }: { movie: Movie | null; index: number }) {
  const placeholderTitles = [
    "A recent favorite",
    "A questionable classic",
    "One for the archives",
    "A movie happened",
  ];

  return (
    <Card className="overflow-hidden p-3">
      <div className="flex gap-3">
        <Poster
          path={movie?.poster_path}
          title={movie?.title ?? placeholderTitles[index]}
        />
        <div className="flex flex-col justify-center">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">
            {movie ? "Recently viewed" : "Coming soon"}
          </p>
          <p className="mt-2 font-display text-lg font-bold text-white">
            {movie?.title ?? "More history"}
          </p>
          {movie?.rating_score !== null &&
            movie?.rating_score !== undefined && (
              <p className="mt-2 text-xs text-lime-300">
                {movie.rating_score}/5 · {movie.rating_phrase}
              </p>
            )}
        </div>
      </div>
    </Card>
  );
}

function AddMovieSection({
  run,
  refresh,
}: {
  run: RunAction;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [franchiseName, setFranchiseName] = useState("");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [selected, setSelected] = useState<TmdbResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setTitle("");
    setFranchiseName("");
    setResults([]);
    setSelected(null);
    setSearchError(null);
  };

  const search = async () => {
    if (!title.trim()) return;
    setSearching(true);
    setSearchError(null);

    try {
      setResults((await api.tmdbSearch(title)).results);
    } catch (cause) {
      setSearchError(
        cause instanceof Error ? cause.message : "TMDB search failed",
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="border-t border-white/8 pt-16">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <SectionHeading
          eyebrow="Contribute"
          title="Add to the list"
          description="Find the movie, confirm the match, and send it into rotation."
        />
        <Button
          onClick={() => setOpen((value) => !value)}
          variant={open ? "secondary" : "primary"}
        >
          {open ? <X size={16} /> : <Plus size={16} />}
          {open ? "Close" : "Add a movie"}
        </Button>
      </div>

      {open && (
        <Card className="mt-5 p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setSelected(null);
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
                onClick={() => void search()}
                disabled={searching || !title.trim()}
              >
                {searching ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Search size={16} />
                )}
                Search TMDB
              </Button>
            </div>
            <Input
              value={franchiseName}
              onChange={(event) => setFranchiseName(event.target.value)}
              placeholder="Series / franchise (optional)"
            />
          </div>

          {searchError && (
            <p className="mt-4 text-sm text-red-200">{searchError}</p>
          )}

          {results.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => {
                    setSelected(result);
                    setTitle(result.title);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 text-left transition",
                    selected?.id === result.id
                      ? "border-lime-300 bg-lime-300/10"
                      : "border-white/8 bg-white/[0.03] hover:border-white/20",
                  )}
                >
                  <Poster path={result.posterPath} title={result.title} />
                  <span>
                    <span className="block font-semibold text-white">
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

          {title && (
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/8 pt-5">
              <p className="text-sm text-zinc-400">
                {selected
                  ? `Confirmed: ${selected.title}`
                  : "You can add this title without a TMDB match."}
              </p>
              <Button
                onClick={() =>
                  void run(
                    () =>
                      api.addMovie({
                        title,
                        franchiseName,
                        releaseDate: selected?.releaseDate,
                        posterPath: selected?.posterPath,
                        tmdbId: selected?.id,
                        imdbId: selected?.imdbId,
                      }),
                    () => {
                      reset();
                      void refresh();
                    },
                  )
                }
              >
                <Plus size={16} />
                Add movie
              </Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
