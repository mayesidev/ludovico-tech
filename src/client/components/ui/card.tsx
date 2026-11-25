import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Card({
  className,
  variant,
  ...props
}: ComponentProps<"section"> & { variant?: "empty" | "interactive" }) {
  return (
    <section
      data-slot="card"
      className={cn(
        "surface-panel rounded-sm border",
        variant === "empty" && "p-6 text-sm text-text-muted",
        variant === "interactive" &&
          "p-4 transition hover:border-highlight/35 hover:bg-surface-interactive/55",
        className,
      )}
      {...props}
    />
  );
}
