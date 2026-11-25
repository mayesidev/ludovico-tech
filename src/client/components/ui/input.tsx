import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Input({
  adornment,
  className,
  ...props
}: ComponentProps<"input"> & { adornment?: "start" | "end" }) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-11 w-full rounded-sm border border-border-subtle bg-canvas/75 px-3.5 text-sm text-text-primary outline-none placeholder:text-text-muted/65 focus:border-highlight focus:ring-2 focus:ring-highlight/15 aria-invalid:border-danger/70 aria-invalid:focus:border-danger",
        adornment === "start" && "pl-9",
        adornment === "end" && "pr-10",
        className,
      )}
      {...props}
    />
  );
}
