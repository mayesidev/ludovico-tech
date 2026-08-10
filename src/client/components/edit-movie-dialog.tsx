import { useId, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { Movie } from "../api";
import { api } from "../api";
import { parseTmdbId } from "../lib/tmdb-id";
import type { RunAction } from "../types";
import { Dialog } from "./dialog";
import { TmdbMovieFields } from "./tmdb-movie-fields";
import { Button, Input } from "./ui";

export function EditMovieDialog({
  busy,
  movie,
  onAuthExpired,
  onClose,
  run,
}: {
  busy: boolean;
  movie: Movie;
  onAuthExpired: () => Promise<void>;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState(movie.title);
  const [collectionName, setCollectionName] = useState(
    movie.collection_name ?? "",
  );
  const [tmdbId, setTmdbId] = useState(
    movie.tmdb_id === null ? "" : String(movie.tmdb_id),
  );
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const collectionId = useId();
  const parsedTmdbId = parseTmdbId(tmdbId);
  const invalidTitle = attempted && !title.trim();

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
          if (!title.trim() || parsedTmdbId === undefined) return;
          const titleChanged = title.trim() !== movie.title;
          const tmdbChanged = parsedTmdbId !== movie.tmdb_id;
          void run(
            () =>
              api.updateMovie(movie.id, {
                collectionName,
                title,
                tmdbId: titleChanged || tmdbChanged ? parsedTmdbId : undefined,
              }),
            onClose,
          );
        }}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-marquee-gold">
              Movie details
            </p>
            <h2
              className="mt-2 font-display text-3xl font-bold text-cream"
              id={titleId}
            >
              Edit movie
            </h2>
            <p
              className="mt-2 text-sm leading-6 text-zinc-400"
              id={descriptionId}
            >
              Update the catalog title, collection, or confirmed TMDB match.
            </p>
          </div>
          <button
            className="text-zinc-500 hover:text-marquee-light"
            onClick={onClose}
            aria-label="Close edit dialog"
            type="button"
          >
            <X />
          </button>
        </div>

        <div className="space-y-4">
          <TmdbMovieFields
            onAuthExpired={onAuthExpired}
            onTitleChange={setTitle}
            onTmdbIdChange={setTmdbId}
            title={title}
            titleErrorId={errorId}
            titleInputRef={inputRef}
            titleInvalid={invalidTitle}
            tmdbId={tmdbId}
          />
          {invalidTitle && (
            <p className="mt-2 text-sm text-red-200" id={errorId} role="alert">
              Enter a movie title.
            </p>
          )}
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
            Collection
            <Input
              className="mt-2"
              id={collectionId}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || parsedTmdbId === undefined} type="submit">
            <Pencil size={16} />
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
