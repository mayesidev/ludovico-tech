import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { forwardRef } from "react";
import { cn } from "../lib/utils";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
  }
>(({ className, variant = "primary", ...props }, ref) => (
  <button
    className={cn(
      "ui-label inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-45",
      variant === "primary" &&
        "border border-action bg-action text-text-primary shadow-lg shadow-black/15 hover:border-action-hover hover:bg-action-hover",
      variant === "secondary" &&
        "border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:bg-surface-elevated hover:text-text-primary",
      variant === "ghost" &&
        "text-text-secondary hover:bg-surface-interactive hover:text-text-primary",
      variant === "danger" &&
        "border border-danger/45 bg-danger-surface/35 text-danger hover:border-danger hover:bg-danger-surface",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Button.displayName = "Button";

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <section className={cn("surface-panel rounded-sm border", className)}>
    {children}
  </section>
);

export const Badge = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <span
    className={cn(
      "metadata-value inline-flex items-center border-l-2 border-highlight bg-surface-interactive px-3 py-2 text-highlight-soft",
      className,
    )}
  >
    {children}
  </span>
);

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    className={cn(
      "h-11 w-full rounded-sm border border-border-subtle bg-canvas/75 px-3.5 text-sm text-text-primary outline-none placeholder:text-text-muted/65 focus:border-highlight focus:ring-2 focus:ring-highlight/15 aria-invalid:border-danger/70 aria-invalid:focus:border-danger",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export const SectionHeading = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) => (
  <div className="mb-5">
    <p className="ui-label mb-2 text-highlight">{eyebrow}</p>
    <h2 className="font-heading text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
      {title}
    </h2>
    {description && (
      <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
        {description}
      </p>
    )}
  </div>
);
