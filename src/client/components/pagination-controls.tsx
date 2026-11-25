import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Pagination } from "./ui/pagination";

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
    <Pagination aria-label={`${context} pagination`}>
      <span>
        {rangeStart}–{rangeEnd} of {total} {itemLabel}
        {refreshing ? " · Updating…" : ""}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Label variant="inline">
          <span>Rows per page</span>
          <NativeSelect
            aria-label={`${context} rows per page`}
            disabled={refreshing}
            size="compact"
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(Number(event.target.value) as 25 | 50 | 100)
            }
          >
            <NativeSelectOption value={25}>25</NativeSelectOption>
            <NativeSelectOption value={50}>50</NativeSelectOption>
            <NativeSelectOption value={100}>100</NativeSelectOption>
          </NativeSelect>
        </Label>
        <Label variant="inline">
          <span>Page</span>
          <NativeSelect
            aria-label={`${context} page`}
            disabled={refreshing || totalPages <= 1}
            size="compact"
            value={page}
            onChange={(event) => onPageChange(Number(event.target.value))}
          >
            {Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (pageOption) => (
                <NativeSelectOption key={pageOption} value={pageOption}>
                  {pageOption}
                </NativeSelectOption>
              ),
            )}
          </NativeSelect>
          <span>of {totalPages}</span>
        </Label>
        <Button
          aria-label={`Previous ${context} page`}
          disabled={refreshing || page <= 1}
          onClick={() => onPageChange(page - 1)}
          size="icon"
          type="button"
          variant="secondary"
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          aria-label={`Next ${context} page`}
          disabled={refreshing || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          size="icon"
          type="button"
          variant="secondary"
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </Pagination>
  );
}
