import { useId, useRef } from "react";
import { Trash2, X } from "lucide-react";
import type { Movie } from "../api";
import { formatMovieTitle } from "../lib/utils";
import { Dialog } from "./dialog";
import { Button } from "./ui";

export function DeleteMovieDialog({
  busy,
  movie,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  movie: Movie;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const movieTitle = formatMovieTitle(movie.title, movie.version);

  return (
    <Dialog
      describedBy={descriptionId}
      initialFocus={cancelRef}
      labelledBy={titleId}
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-200">
            Remove from library
          </p>
          <h2
            className="mt-2 font-display text-3xl font-bold text-cream"
            id={titleId}
          >
            Delete {movieTitle}?
          </h2>
          <p
            className="mt-3 text-sm leading-6 text-zinc-400"
            id={descriptionId}
          >
            This removes the unwatched movie and its catalog references. This
            action cannot be undone.
          </p>
        </div>
        <Button
          aria-label="Close delete dialog"
          onClick={onClose}
          variant="ghost"
        >
          <X size={18} />
        </Button>
      </div>

      <div className="mt-7 flex flex-wrap justify-end gap-3">
        <Button onClick={onClose} ref={cancelRef} type="button" variant="ghost">
          Keep movie
        </Button>
        <Button
          disabled={busy}
          onClick={onConfirm}
          type="button"
          variant="danger"
        >
          <Trash2 size={16} />
          Delete movie
        </Button>
      </div>
    </Dialog>
  );
}
