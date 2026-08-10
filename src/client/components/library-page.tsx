import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Pencil, Search } from "lucide-react";
import type { Movie } from "../api";
import type { Navigate } from "../types";
import { formatDate } from "../lib/utils";
import { AppLink } from "./app-link";
import { Badge, Card, Input } from "./ui";

type LibraryPageProps = {
  canMutate: boolean;
  movies: Movie[];
  onEdit: (movie: Movie) => void;
  onNavigate: Navigate;
};

export function LibraryPage({
  canMutate,
  movies,
  onEdit,
  onNavigate,
}: LibraryPageProps) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Movie>[]>(() => {
    const definitions: ColumnDef<Movie>[] = [
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <AppLink
            className="font-semibold text-cream hover:text-marquee-light"
            href={`/movies/${encodeURIComponent(row.original.id)}`}
            onNavigate={onNavigate}
          >
            {row.original.title}
          </AppLink>
        ),
      },
      {
        accessorKey: "franchise_name",
        header: "Franchise",
        cell: ({ row }) =>
          row.original.franchise_id && row.original.franchise_name ? (
            <AppLink
              className="hover:text-marquee-light"
              href={`/franchises/${encodeURIComponent(row.original.franchise_id)}`}
              onNavigate={onNavigate}
            >
              {row.original.franchise_name}
            </AppLink>
          ) : null,
      },
      {
        accessorKey: "release_date",
        header: "Release",
        cell: ({ getValue }) => formatDate(getValue<string | null>()),
      },
      {
        accessorKey: "added_at",
        header: "Date added",
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: "rating_score",
        header: "Rating",
        cell: ({ row }) =>
          row.original.rating_score !== null ? (
            <span className="text-marquee-light">
              {row.original.rating_score} · {row.original.rating_phrase}
            </span>
          ) : null,
      },
      {
        accessorKey: "watched_at",
        header: "Status",
        cell: ({ row }) =>
          row.original.rating_score !== null ? (
            <Badge>Watched</Badge>
          ) : (
            <Badge>Unwatched</Badge>
          ),
      },
    ];
    if (canMutate) {
      definitions.push({
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-marquee-gold/15 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-marquee-gold/35 hover:text-marquee-light"
              onClick={() => onEdit(row.original)}
            >
              <Pencil size={13} />
              Edit
            </button>
          </div>
        ),
      });
    }
    return definitions;
  }, [canMutate, onEdit, onNavigate]);
  const table = useReactTable({
    data: movies,
    columns,
    state: { globalFilter: filter, sorting },
    onGlobalFilterChange: setFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-normal text-cream sm:text-4xl">
            Library
          </h1>
          <p className="mt-2 text-sm text-zinc-500">{movies.length} movies</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-3.5 text-zinc-600" size={16} />
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

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-curtain/35 bg-curtain/10 text-xs uppercase tracking-[0.14em] text-zinc-500">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : header.column.getCanSort()
                              ? "none"
                              : undefined
                      }
                      key={header.id}
                      className="px-5 py-4 font-bold"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className="hover:text-marquee-light"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {header.column.getIsSorted()
                            ? header.column.getIsSorted() === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-marquee-gold/8">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition hover:bg-curtain/15">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-5 py-4 text-zinc-400">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-curtain/35 px-5 py-4 text-xs text-zinc-600">
          {table.getFilteredRowModel().rows.length} of {movies.length} movies
        </div>
      </Card>
    </div>
  );
}
