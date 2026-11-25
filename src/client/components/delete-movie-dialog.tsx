import { Trash2, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { Movie } from "../api";
import { formatMovieTitle } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function DeleteMovieDialog({
  busy,
  movie,
  notice,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  movie: Movie;
  notice?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const movieTitle = formatMovieTitle(movie.title, movie.version);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent initialFocus={cancelRef}>
        {notice}
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>Delete {movieTitle}?</DialogTitle>
            <DialogDescription className="mt-3">
              This removes the unwatched movie and its catalog references. This
              action cannot be undone.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close Delete Dialog"
            render={<Button variant="ghost" />}
          >
            <X size={18} />
          </DialogClose>
        </div>

        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <DialogClose render={<Button ref={cancelRef} variant="ghost" />}>
            Keep Movie
          </DialogClose>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="danger"
          >
            <Trash2 size={16} />
            Delete Movie
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
