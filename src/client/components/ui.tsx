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
      "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marquee-light focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-45",
      variant === "primary" &&
        "bg-marquee-gold text-ink shadow-lg shadow-marquee-gold/10 hover:bg-marquee-light",
      variant === "secondary" &&
        "border border-marquee-gold/25 bg-curtain/20 text-cream hover:border-marquee-gold/45 hover:bg-curtain/35",
      variant === "ghost" &&
        "text-zinc-300 hover:bg-curtain/25 hover:text-cream",
      variant === "danger" &&
        "border border-red-300/20 bg-red-500/20 text-red-100 hover:bg-red-500/30",
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
  <section
    className={cn(
      "theater-card rounded-3xl border shadow-2xl shadow-black/30",
      className,
    )}
  >
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
      "inline-flex items-center rounded-full border border-marquee-gold/20 bg-curtain/25 px-2.5 py-1 text-xs font-medium text-marquee-light",
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
      "h-11 w-full rounded-2xl border border-marquee-gold/15 bg-black/25 px-3.5 text-sm text-cream outline-none placeholder:text-zinc-600 focus:border-marquee-gold/70 focus:ring-2 focus:ring-marquee-gold/15",
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
    <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-marquee-gold">
      {eyebrow}
    </p>
    <h2 className="font-display text-2xl font-bold tracking-tight text-cream sm:text-3xl">
      {title}
    </h2>
    {description && (
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        {description}
      </p>
    )}
  </div>
);
