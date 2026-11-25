import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const accentColor = "text-highlight-soft hover:text-text-primary";
const linkVariants = {
  default: "hover:text-highlight-soft",
  accent: `font-semibold ${accentColor}`,
  brand: "flex min-w-0 items-center gap-2.5 py-3 text-left sm:gap-3",
  inherit: "",
  muted:
    "ui-label inline-flex items-center gap-2 text-text-muted hover:text-highlight-soft",
  navigation:
    "nav-label relative grid shrink-0 place-items-center px-3 whitespace-nowrap text-text-muted hover:text-text-primary aria-[current=page]:text-text-primary aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-5 aria-[current=page]:after:bottom-[-1px] aria-[current=page]:after:h-[3px] aria-[current=page]:after:bg-action sm:min-w-32 sm:px-6",
  reference: `font-normal ${accentColor}`,
  title: "font-semibold text-text-primary hover:text-highlight-soft",
};

export function Link({
  className,
  size = "default",
  variant = "default",
  withIcon = false,
  ...props
}: ComponentProps<"a"> & {
  href: string;
  size?: "default" | "sm";
  variant?: keyof typeof linkVariants;
  withIcon?: boolean;
}) {
  return (
    <a
      data-slot="link"
      className={cn(
        "rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none",
        withIcon && "inline-flex items-center gap-1.5",
        size === "sm" && "text-sm tracking-normal",
        linkVariants[variant],
        className,
      )}
      {...props}
    />
  );
}
