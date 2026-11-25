import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<ComponentProps<"select">, "size"> & {
  size?: "compact" | "default";
}) {
  return (
    <span
      data-slot="native-select-wrapper"
      className={cn("relative block", className)}
    >
      <select
        data-slot="native-select"
        className={cn(
          "w-full appearance-none rounded-sm border text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
          size === "compact"
            ? "h-9 border-border-primary bg-canvas pr-6 pl-2"
            : "h-11 border-border-subtle bg-canvas/75 pr-8 pl-3 text-sm",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-text-muted"
      />
    </span>
  );
}

export function NativeSelectOption({
  className,
  ...props
}: ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-canvas text-text-primary", className)}
      {...props}
    />
  );
}
