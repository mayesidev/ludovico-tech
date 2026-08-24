import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationControlsProps = {
  context: string;
  itemLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: 25 | 50 | 100) => void;
  page: number;
  pageSize: number;
  refreshing: boolean;
  total: number;
  totalPages: number;
};

export function PaginationControls({
  context,
  itemLabel,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  refreshing,
  total,
  totalPages,
}: PaginationControlsProps) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-4 border-t border-action/45 bg-action/10 px-5 py-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
      <span>
        {rangeStart}–{rangeEnd} of {total} {itemLabel}
        {refreshing ? " · Updating…" : ""}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label={`${context} rows per page`}
            className="h-9 rounded-sm border border-border-primary bg-canvas px-2 text-text-primary"
            disabled={refreshing}
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(Number(event.target.value) as 25 | 50 | 100)
            }
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 tabular-nums">
          <span>Page</span>
          <select
            aria-label={`${context} page`}
            className="h-9 rounded-sm border border-border-primary bg-canvas px-2 text-text-primary"
            disabled={refreshing || totalPages <= 1}
            value={page}
            onChange={(event) => onPageChange(Number(event.target.value))}
          >
            {Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (pageOption) => (
                <option key={pageOption} value={pageOption}>
                  {pageOption}
                </option>
              ),
            )}
          </select>
          <span>of {totalPages}</span>
        </label>
        <button
          aria-label={`Previous ${context} page`}
          className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
          disabled={refreshing || page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label={`Next ${context} page`}
          className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
          disabled={refreshing || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
