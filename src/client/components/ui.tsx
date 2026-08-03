import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

export const Button = ({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) => (
  <button
    className={cn(
      "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:cursor-not-allowed disabled:opacity-45",
      variant === "primary" && "bg-lime-300 text-zinc-950 hover:bg-lime-200",
      variant === "secondary" && "border border-white/15 bg-white/8 text-white hover:bg-white/14",
      variant === "ghost" && "text-zinc-300 hover:bg-white/10 hover:text-white",
      variant === "danger" && "bg-red-400/15 text-red-200 hover:bg-red-400/25",
      className,
    )}
    {...props}
  />
);

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={cn("rounded-3xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/20", className)}>{children}</section>
);

export const Badge = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-xs font-medium text-zinc-300", className)}>{children}</span>
);

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn("h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/10", className)} {...props} />
);

export const SectionHeading = ({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) => (
  <div className="mb-5">
    <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-lime-300">{eyebrow}</p>
    <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
    {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>}
  </div>
);
