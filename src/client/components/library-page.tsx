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
  movies: Movie[];
  onEdit: (movie: Movie) => void;
  onOrder: (franchiseId: string) => Promise<void>;
};

export function LibraryPage({ movies, onEdit, onOrder }: LibraryPageProps) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Movie>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-white">{row.original.title}</p>
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
            <span className="text-lime-300">{row.original.rating_score}/5</span>
          ),
      },
      {
        accessorKey: "watched_at",
        header: "Status",
        cell: ({ row }) =>
          row.original.rating_score !== null ? (
            <Badge className="border-lime-300/20 bg-lime-300/10 text-lime-200">
              Watched
            </Badge>
          ) : (
            <Badge>In rotation</Badge>
          ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-white/25 hover:text-white"
              onClick={() => onEdit(row.original)}
            >
              <Pencil size={13} />
              Edit
            </button>
            {row.original.franchise_id && (
              <button
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-white/25 hover:text-white"
                onClick={() => void onOrder(row.original.franchise_id!)}
              >
                Order
              </button>
            )}
          </div>
        ),
      },
    ],
    [onEdit, onOrder],
  );
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
          <Input
            className="pl-9"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search titles…"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-zinc-500">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-5 py-4 font-bold">
                      {header.column.getCanSort() ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className="hover:text-white"
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
            <tbody className="divide-y divide-white/6">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition hover:bg-white/[0.035]">
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
        <div className="border-t border-white/8 px-5 py-4 text-xs text-zinc-600">
          {table.getFilteredRowModel().rows.length} of {movies.length} movies
        </div>
      </Card>
    </div>
  );
}
