import { useState } from "react";
import { X } from "lucide-react";
import type { Movie } from "../api";
import { api } from "../api";
import type { RunAction } from "../types";
import { Button, Card, Input } from "./ui";

export function EditMovieDialog({
  movie,
  onClose,
  run,
}: {
  movie: Movie;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState(movie.title);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-5 backdrop-blur-sm">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
              Movie details
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold text-white">
              Edit title
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Release dates and posters are managed through TMDB.
            </p>
          </div>
          <button
            className="text-zinc-500 hover:text-white"
            onClick={onClose}
            aria-label="Close edit dialog"
          >
            <X />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
            Title
            <Input
              className="mt-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() =>
              void run(
                () =>
                  api.updateMovie(movie.id, {
                    title,
                  }),
                onClose,
              )
            }
          >
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  );
}
