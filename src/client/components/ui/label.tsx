import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Label({
  className,
  variant = "default",
  ...props
}: ComponentProps<"label"> & {
  variant?: "default" | "field" | "choice" | "inline" | "stacked";
}) {
  return (
    <label
      data-slot="label"
      className={cn(
        variant === "default" && "text-text-muted",
        variant === "field" && "ui-label block text-text-muted",
        variant === "choice" &&
          "flex cursor-pointer items-start gap-3 text-sm text-text-primary has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50",
        variant === "inline" &&
          "inline-flex items-center gap-2 text-text-muted tabular-nums",
        variant === "stacked" && "grid gap-1.5 text-text-muted",
        className,
      )}
      {...props}
    />
  );
}
