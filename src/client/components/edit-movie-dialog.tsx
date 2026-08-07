import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Movie } from "../api";
import { api } from "../api";
import type { RunAction } from "../types";
import { Dialog } from "./dialog";
import { Button, Input } from "./ui";

export function EditMovieDialog({
  busy,
  movie,
  onClose,
  run,
}: {
  busy: boolean;
  movie: Movie;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState(movie.title);
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const invalid = attempted && !title.trim();

  return (
    <Dialog
      describedBy={descriptionId}
      initialFocus={inputRef}
      labelledBy={titleId}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (!title.trim()) return;
          void run(() => api.updateMovie(movie.id, { title }), onClose);
        }}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
              Movie details
            </p>
            <h2
              className="mt-2 font-display text-3xl font-bold text-white"
              id={titleId}
            >
              Edit title
            </h2>
            <p
              className="mt-2 text-sm leading-6 text-zinc-400"
              id={descriptionId}
            >
              Release dates and posters are managed through TMDB.
            </p>
          </div>
          <button
            className="text-zinc-500 hover:text-white"
            onClick={onClose}
            aria-label="Close edit dialog"
            type="button"
          >
            <X />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
            Title
            <Input
              aria-describedby={invalid ? errorId : undefined}
              aria-invalid={invalid}
              className="mt-2"
              ref={inputRef}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {invalid && (
            <p className="mt-2 text-sm text-red-200" id={errorId} role="alert">
              Enter a movie title.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} type="submit">
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
