import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "../lib/utils";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({
  children,
  className,
  describedBy,
  initialFocus,
  labelledBy,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  describedBy?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  labelledBy: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    const overlay = dialog?.parentElement;
    const background = Array.from(
      overlay?.parentElement?.children ?? [],
    ).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay,
    );
    const backgroundState = background.map((element) => ({
      ariaHidden: element.getAttribute("aria-hidden"),
      element,
      inert: element.inert,
    }));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    for (const element of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    (
      initialFocus?.current ??
      dialog?.querySelector<HTMLElement>(focusableSelector) ??
      dialog
    )?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const { ariaHidden, element, inert } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      returnFocus?.focus();
    };
  }, [initialFocus]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-5 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={cn(
          "theater-dialog max-h-[calc(100vh-2.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl border p-6 shadow-2xl shadow-black/50 sm:p-8",
          className,
        )}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
