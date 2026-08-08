import { useId, useRef } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { Dialog } from "./dialog";
import { Button } from "./ui";

type FranchiseOrderDialogProps = {
  busy: boolean;
  draft: Movie[];
  franchiseId: string;
  onChange: (draft: Movie[] | null) => void;
  run: RunAction;
};

export function FranchiseOrderDialog({
  busy,
  draft,
  franchiseId,
  onChange,
  run,
}: FranchiseOrderDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft];
    const swapIndex = index + direction;

    if (swapIndex < 0 || swapIndex >= next.length) return;

    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange(next);
  };

  return (
    <Dialog
      describedBy={descriptionId}
      initialFocus={confirmRef}
      labelledBy={titleId}
      onClose={() => onChange(null)}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-marquee-gold">
            Franchise order
          </p>
          <h2
            className="mt-2 font-display text-3xl font-bold text-cream"
            id={titleId}
          >
            How should we watch it?
          </h2>
          <p
            className="mt-2 text-sm leading-6 text-zinc-400"
            id={descriptionId}
          >
            Set the order once. You can edit it later from the library.
          </p>
        </div>
        <button
          aria-label="Close franchise order dialog"
          className="text-zinc-500 hover:text-marquee-light"
          onClick={() => onChange(null)}
          type="button"
        >
          <X />
        </button>
      </div>

      <div className="space-y-2">
        {draft.map((movie, index) => (
          <div
            key={movie.id}
            className="flex items-center gap-3 rounded-2xl border border-marquee-gold/10 bg-black/20 p-3"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-curtain/30 text-xs font-bold text-marquee-light">
              {index + 1}
            </span>
            <span className="flex-1 text-sm font-medium text-cream">
              {movie.title}
            </span>
            <div className="flex gap-1">
              <button
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-curtain/30 hover:text-marquee-light"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${movie.title} up`}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-curtain/30 hover:text-marquee-light"
                disabled={index === draft.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${movie.title} down`}
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onChange(null)}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          ref={confirmRef}
          onClick={() =>
            void run(
              () =>
                api.order(
                  franchiseId,
                  draft.map((movie) => movie.id),
                ),
              () => onChange(null),
            )
          }
        >
          Use this order
        </Button>
      </div>
    </Dialog>
  );
}
