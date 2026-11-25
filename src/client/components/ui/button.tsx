import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { Ref } from "react";
import { cn } from "../../lib/utils";

const primaryButton =
  "border border-action bg-action text-text-primary shadow-lg shadow-black/15 hover:border-action-hover hover:bg-action-hover";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-sm transition focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: primaryButton,
        secondary:
          "border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:bg-surface-elevated hover:text-text-primary",
        ghost:
          "text-text-secondary hover:bg-surface-interactive hover:text-text-primary",
        danger:
          "border border-danger/45 bg-danger-surface/35 text-danger hover:border-danger hover:bg-danger-surface",
        rating: primaryButton,
        text: "text-text-primary hover:text-highlight-soft",
        link: "text-sm font-semibold text-highlight-soft underline decoration-highlight-soft/45 underline-offset-4 hover:text-text-primary",
        plain: "",
      },
      size: {
        default: "min-h-11 px-4",
        compact: "min-h-9 px-3",
        responsive: "min-h-11 px-3 sm:px-4",
        header: "px-3 py-2",
        icon: "size-9 shrink-0",
        bare: "",
      },
      labelStyle: {
        default: "ui-label gap-2",
        header: "header-label gap-2",
        plain: "",
      },
    },
    compoundVariants: [
      {
        variant: "rating",
        class: "min-h-16 rounded-none",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
      labelStyle: "default",
    },
  },
);

export function Button({
  className,
  labelStyle,
  size,
  variant,
  ...props
}: Omit<ButtonPrimitive.Props, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    ref?: Ref<HTMLButtonElement>;
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, labelStyle }), className)}
      {...props}
    />
  );
}
