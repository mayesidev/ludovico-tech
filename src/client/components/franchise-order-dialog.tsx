import { ArrowDown, ArrowUp } from "lucide-react";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { Button, Card } from "./ui";

type FranchiseOrderDialogProps = {
  draft: Movie[];
  franchiseId: string;
  onChange: (draft: Movie[] | null) => void;
  run: RunAction;
};

export function FranchiseOrderDialog({
  draft,
  franchiseId,
  onChange,
  run,
}: FranchiseOrderDialogProps) {
  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft];
    const swapIndex = index + direction;

    if (swapIndex < 0 || swapIndex >= next.length) return;

    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange(next);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-5 backdrop-blur-sm">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
            Franchise order
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold text-white">
            How should we watch it?
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Set the order once. You can edit it later from the library.
          </p>
        </div>

        <div className="space-y-2">
          {draft.map((movie, index) => (
            <div
              key={movie.id}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3"
            >
              <span className="grid size-7 place-items-center rounded-lg bg-white/8 text-xs font-bold text-zinc-400">
                {index + 1}
              </span>
              <span className="flex-1 text-sm font-medium text-white">
                {movie.title}
              </span>
              <div className="flex gap-1">
                <button
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${movie.title} up`}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${movie.title} down`}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <Button
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
      </Card>
    </div>
  );
}
