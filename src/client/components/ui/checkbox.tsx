import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-xs border border-text-muted bg-canvas align-middle outline-none focus-visible:ring-2 focus-visible:ring-focus data-checked:border-highlight data-checked:bg-highlight data-checked:text-canvas data-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <Check aria-hidden="true" size={13} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
