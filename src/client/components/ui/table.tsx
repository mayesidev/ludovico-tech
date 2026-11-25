import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full table-fixed text-left text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "ui-label border-b border-highlight/15 bg-table-header text-text-primary/80",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("data-surface divide-y divide-border-subtle", className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  variant,
  ...props
}: ComponentProps<"tr"> & { variant?: "data" }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        variant === "data" && "bg-canvas/35 transition hover:bg-action/15",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  divided = false,
  ...props
}: ComponentProps<"th"> & { divided?: boolean }) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "px-5 py-4 font-semibold",
        divided && "border-r border-highlight/10 last:border-r-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  variant = "default",
  ...props
}: ComponentProps<"td"> & { variant?: "default" | "wrap" | "empty" }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-5 text-text-muted",
        variant === "empty" ? "py-8 text-center" : "py-4",
        variant === "wrap" && "break-words",
        className,
      )}
      {...props}
    />
  );
}
