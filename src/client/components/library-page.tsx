import { ExternalLink, Pencil, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { imdbTitleUrl } from "../../shared/imdb";
import {
  api,
  type LibraryQuery,
  type LibraryResponse,
  type Movie,
} from "../api";
import { formatDate, formatMovieTitle } from "../lib/utils";
import type { Navigate } from "../types";
import { AppLink } from "./app-link";
import { PaginationControls } from "./pagination-controls";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Link } from "./ui/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

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
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setRefreshing(true);
      try {
        const response = await api.library(query);
        if (cancelled) return;
        setData(response);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Unable to load the Library",
        );
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    });
    return () => {
      cancelled = true;
    };
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
      <TableHead
        aria-sort={
          active
            ? query.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        divided
      >
        <Button
          labelStyle="plain"
          onClick={() => changeSort(sort)}
          size="bare"
          variant="text"
        >
          {label}
          {active ? (query.direction === "asc" ? " ↑" : " ↓") : ""}
        </Button>
      </TableHead>
    );
  };

  const movies = data?.movies ?? [];
  const page = data?.pagination.page ?? query.page;
  const pageSize = data?.pagination.pageSize ?? query.pageSize;
  const filteredTotal = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-3xl leading-none font-medium tracking-heading text-text-primary sm:text-4xl">
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
            className="absolute top-3.5 left-3 text-text-muted"
            size={16}
          />
          <Label className="sr-only" htmlFor="library-search">
            Search movie library
          </Label>
          <Input
            adornment="start"
            id="library-search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search all fields…"
          />
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <Card aria-busy={refreshing} className="overflow-hidden">
        <Table className="min-w-[1050px]">
          <colgroup>
            <col className="w-[220px]" />
            <col className="w-[150px]" />
            <col className="w-[110px]" />
            <col className="w-[130px]" />
            <col className="w-[150px]" />
            <col className="w-[170px]" />
            {canMutate && <col className="w-[120px]" />}
          </colgroup>
          <TableHeader>
            <TableRow>
              {sortHeader("Title", "title")}
              {sortHeader("Collection", "collection")}
              {sortHeader("Release", "releaseDate")}
              {sortHeader("Date Added", "addedAt")}
              {sortHeader("Rating", "rating")}
              <TableHead divided>Links</TableHead>
              {canMutate && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movies.map((movie) => {
              const title = formatMovieTitle(movie.title, movie.version);
              return (
                <TableRow variant="data" key={movie.id}>
                  <TableCell variant="wrap">
                    <AppLink
                      variant="title"
                      href={`/movies/${encodeURIComponent(movie.id)}?from=library`}
                      onNavigate={onNavigate}
                    >
                      {title}
                    </AppLink>
                  </TableCell>
                  <TableCell variant="wrap">
                    {movie.collection_id && movie.collection_name ? (
                      <AppLink
                        href={`/collections/${encodeURIComponent(movie.collection_id)}`}
                        onNavigate={onNavigate}
                      >
                        {movie.collection_name}
                      </AppLink>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDate(movie.release_date)}</TableCell>
                  <TableCell>{formatDate(movie.added_at)}</TableCell>
                  <TableCell variant="wrap">
                    {movie.rating_score !== null ? (
                      <span className="text-highlight-soft">
                        {movie.rating_score} · {movie.rating_phrase}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <MovieLinks movie={movie} />
                  </TableCell>
                  {canMutate && (
                    <TableCell>
                      <Button
                        onClick={() => onEdit(movie)}
                        size="compact"
                        variant="secondary"
                      >
                        <Pencil size={13} />
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {!refreshing && movies.length === 0 && (
              <TableRow>
                <TableCell variant="empty" colSpan={canMutate ? 7 : 6}>
                  No movies match this search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <PaginationControls
          context="Library"
          itemLabel="movies"
          page={page}
          pageSize={pageSize}
          refreshing={refreshing}
          total={filteredTotal}
          totalPages={totalPages}
          onPageChange={(nextPage) =>
            setQuery((current) => ({ ...current, page: nextPage }))
          }
          onPageSizeChange={(nextPageSize) =>
            setQuery((current) => ({
              ...current,
              page: 1,
              pageSize: nextPageSize,
            }))
          }
        />
      </Card>
    </div>
  );
}

function MovieLinks({ movie }: { movie: Movie }) {
  const { imdb_id: imdbId, tmdb_id: tmdbId } = movie;
  if (tmdbId === null && imdbId === null) return null;
  return (
    <span className="inline-flex items-center gap-2 font-semibold whitespace-nowrap text-highlight-soft">
      {tmdbId !== null && (
        <Link
          withIcon
          variant="accent"
          href={`https://www.themoviedb.org/movie/${tmdbId}`}
          rel="noreferrer"
          target="_blank"
        >
          TMDB
          <ExternalLink size={13} />
        </Link>
      )}
      {tmdbId !== null && imdbId !== null && (
        <span aria-hidden="true" className="text-border-primary">
          ·
        </span>
      )}
      {imdbId !== null && (
        <Link
          withIcon
          variant="accent"
          href={imdbTitleUrl(imdbId)}
          rel="noreferrer"
          target="_blank"
        >
          IMDb
          <ExternalLink size={13} />
        </Link>
      )}
    </span>
  );
}
