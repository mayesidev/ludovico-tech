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
import { formatDate } from "../lib/utils";
import { Badge, Card, Input, SectionHeading } from "./ui";

type LibraryPageProps = {
  canMutate: boolean;
  movies: Movie[];
  onEdit: (movie: Movie) => void;
  onOrder: (franchiseId: string) => void;
};

export function LibraryPage({
  canMutate,
  movies,
  onEdit,
  onOrder,
}: LibraryPageProps) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Movie>[]>(() => {
    const definitions: ColumnDef<Movie>[] = [
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-cream">{row.original.title}</p>
            <p className="text-xs text-zinc-500">
              {row.original.franchise_name ?? "Standalone"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "release_date",
        header: "Release",
        cell: ({ getValue }) => formatDate(getValue<string | null>()),
      },
      {
        accessorKey: "rating_score",
        header: "Rating",
        cell: ({ row }) =>
          row.original.rating_score === null ? (
            <Badge>Not watched</Badge>
          ) : (
            <span className="text-marquee-light">
              {row.original.rating_score}/5
            </span>
          ),
      },
      {
        accessorKey: "watched_at",
        header: "Status",
        cell: ({ row }) =>
          row.original.rating_score !== null ? (
            <Badge>Watched</Badge>
          ) : (
            <Badge>In rotation</Badge>
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
            {row.original.franchise_id && (
              <button
                className="rounded-lg border border-marquee-gold/15 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-marquee-gold/35 hover:text-marquee-light"
                onClick={() => void onOrder(row.original.franchise_id!)}
              >
                Order
              </button>
            )}
          </div>
        ),
      });
    }
    return definitions;
  }, [canMutate, onEdit, onOrder]);
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
        <SectionHeading
          eyebrow="The library"
          title="Every movie in rotation"
          description="Search the whole list, including movies already viewed."
        />
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
          <table className="w-full min-w-[860px] text-left text-sm">
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
