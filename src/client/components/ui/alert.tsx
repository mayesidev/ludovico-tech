import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Alert({
  className,
  variant = "error",
  ...props
}: ComponentProps<"div"> & { variant?: "error" | "notice" }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        "rounded-sm border border-danger/50 bg-danger-surface px-4 py-3 text-sm",
        variant === "notice"
          ? "flex items-center justify-between gap-4 text-text-primary shadow-2xl shadow-black/60"
          : "text-danger",
        className,
      )}
      {...props}
    />
  );
}
