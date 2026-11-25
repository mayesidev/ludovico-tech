import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Pagination"
      data-slot="pagination"
      className={cn(
        "flex flex-col gap-4 border-t border-action/45 bg-action/10 px-5 py-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}
