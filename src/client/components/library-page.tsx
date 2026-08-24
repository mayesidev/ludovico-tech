import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Search,
} from "lucide-react";
import {
  api,
  type LibraryQuery,
  type LibraryResponse,
  type Movie,
} from "../api";
import { imdbTitleUrl } from "../../shared/imdb";
import type { Navigate } from "../types";
import { formatDate, formatMovieTitle } from "../lib/utils";
import { AppLink } from "./app-link";
import { Card, Input } from "./ui";

type LibraryPageProps = {
  canMutate: boolean;
  onEdit: (movie: Movie) => void;
  onNavigate: Navigate;
  reloadToken: number;
};

const initialQuery: LibraryQuery = {
  direction: "asc",
  page: 1,
  pageSize: 50,
  search: "",
  sort: "title",
  status: "all",
};

type LibrarySort = LibraryQuery["sort"];

export function LibraryPage({
  canMutate,
  onEdit,
  onNavigate,
  reloadToken,
}: LibraryPageProps) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery((current) =>
        current.search === filter
          ? current
          : { ...current, page: 1, search: filter },
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filter]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    void Promise.resolve()
      .then(() => {
        if (sequence !== requestSequence.current) return null;
        setRefreshing(true);
        return api.library(query);
      })
      .then((response) => {
        if (sequence !== requestSequence.current || response === null) return;
        setData(response);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (sequence !== requestSequence.current) return;
        setError(
          cause instanceof Error ? cause.message : "Unable to load the Library",
        );
      })
      .finally(() => {
        if (sequence === requestSequence.current) setRefreshing(false);
      });
  }, [query, reloadToken]);

  const changeSort = (sort: LibrarySort) => {
    setQuery((current) => ({
      ...current,
      direction:
        current.sort === sort
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : sort === "rating"
            ? "desc"
            : "asc",
      page: 1,
      sort,
    }));
  };
  const sortHeader = (label: string, sort: LibrarySort) => {
    const active = query.sort === sort;
    return (
      <th
        aria-sort={
          active
            ? query.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className="border-r border-highlight/10 px-5 py-4 font-semibold last:border-r-0"
      >
        <button
          className="text-text-primary hover:text-highlight-soft"
          onClick={() => changeSort(sort)}
        >
          {label}
          {active ? (query.direction === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  };

  const movies = data?.movies ?? [];
  const page = data?.pagination.page ?? query.page;
  const pageSize = data?.pagination.pageSize ?? query.pageSize;
  const filteredTotal = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const rangeStart = filteredTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, filteredTotal);

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-3xl font-medium leading-none tracking-[0.01em] text-text-primary sm:text-4xl">
            Library
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            {data
              ? `${data.counts.unwatched} unwatched out of ${data.counts.total} movies`
              : "Loading Library…"}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            className="absolute left-3 top-3.5 text-text-muted"
            size={16}
          />
          <label className="sr-only" htmlFor="library-search">
            Search movie library
          </label>
          <Input
            className="pl-9"
            id="library-search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search titles…"
          />
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <Card aria-busy={refreshing} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="ui-label border-b border-highlight/15 bg-[#7a1d30] text-text-primary/80">
              <tr>
                {sortHeader("Title", "title")}
                {sortHeader("Collection", "collection")}
                {sortHeader("Release", "releaseDate")}
                {sortHeader("Date Added", "addedAt")}
                {sortHeader("Rating", "rating")}
                <th className="border-r border-highlight/10 px-5 py-4 font-semibold last:border-r-0">
                  Links
                </th>
                {canMutate && (
                  <th className="px-5 py-4 font-semibold">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="data-surface divide-y divide-border-subtle">
              {movies.map((movie) => {
                const title = formatMovieTitle(movie.title, movie.version);
                return (
                  <tr
                    className="bg-canvas/35 transition hover:bg-action/15"
                    key={movie.id}
                  >
                    <td className="px-5 py-4 text-text-muted">
                      <AppLink
                        className="font-semibold text-text-primary hover:text-highlight-soft"
                        href={`/movies/${encodeURIComponent(movie.id)}?from=library`}
                        onNavigate={onNavigate}
                      >
                        {title}
                      </AppLink>
                    </td>
                    <td className="px-5 py-4 text-text-muted">
                      {movie.collection_id && movie.collection_name ? (
                        <AppLink
                          className="hover:text-highlight-soft"
                          href={`/collections/${encodeURIComponent(movie.collection_id)}`}
                          onNavigate={onNavigate}
                        >
                          {movie.collection_name}
                        </AppLink>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-text-muted">
                      {formatDate(movie.release_date)}
                    </td>
                    <td className="px-5 py-4 text-text-muted">
                      {formatDate(movie.added_at)}
                    </td>
                    <td className="px-5 py-4 text-text-muted">
                      {movie.rating_score !== null ? (
                        <span className="text-highlight-soft">
                          {movie.rating_score} · {movie.rating_phrase}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-text-muted">
                      <MovieLinks movie={movie} />
                    </td>
                    {canMutate && (
                      <td className="px-5 py-4 text-text-muted">
                        <button
                          className="ui-label inline-flex min-h-9 items-center gap-1 rounded-sm border border-border-primary bg-surface/75 px-2.5 py-1.5 text-text-secondary hover:border-text-muted hover:bg-surface-elevated hover:text-text-primary"
                          onClick={() => onEdit(movie)}
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!refreshing && movies.length === 0 && (
                <tr>
                  <td
                    className="px-5 py-8 text-center text-text-muted"
                    colSpan={canMutate ? 7 : 6}
                  >
                    No movies match this search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-4 border-t border-action/45 bg-action/10 px-5 py-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            {rangeStart}–{rangeEnd} of {filteredTotal} movies
            {refreshing ? " · Updating…" : ""}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <span>Rows per page</span>
              <select
                aria-label="Library rows per page"
                className="h-9 rounded-sm border border-border-primary bg-canvas px-2 text-text-primary"
                value={query.pageSize}
                onChange={(event) =>
                  setQuery((current) => ({
                    ...current,
                    page: 1,
                    pageSize: Number(event.target.value) as 25 | 50 | 100,
                  }))
                }
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              aria-label="Previous Library page"
              className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
              disabled={refreshing || page <= 1}
              onClick={() =>
                setQuery((current) => ({ ...current, page: page - 1 }))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="Next Library page"
              className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
              disabled={refreshing || page >= totalPages}
              onClick={() =>
                setQuery((current) => ({ ...current, page: page + 1 }))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MovieLinks({ movie }: { movie: Movie }) {
  const { imdb_id: imdbId, tmdb_id: tmdbId } = movie;
  if (tmdbId === null && imdbId === null) return null;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-highlight-soft">
      {tmdbId !== null && (
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href={`https://www.themoviedb.org/movie/${tmdbId}`}
          rel="noreferrer"
          target="_blank"
        >
          TMDB
          <ExternalLink size={13} />
        </a>
      )}
      {tmdbId !== null && imdbId !== null && (
        <span aria-hidden="true" className="text-border-primary">
          ·
        </span>
      )}
      {imdbId !== null && (
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href={imdbTitleUrl(imdbId)}
          rel="noreferrer"
          target="_blank"
        >
          IMDb
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}
