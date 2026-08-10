import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import { parseTmdbId } from "../lib/tmdb-id";
import type { RunAction } from "../types";
import { Dialog } from "./dialog";
import { TmdbMovieFields } from "./tmdb-movie-fields";
import { Button, Input } from "./ui";

export function AddMovieDialog({
  busy,
  onAuthExpired,
  onClose,
  run,
}: {
  busy: boolean;
  onAuthExpired: () => Promise<void>;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState("");
  const [franchiseName, setFranchiseName] = useState("");
  const [tmdbId, setTmdbId] = useState("");
  const [attempted, setAttempted] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const franchiseId = useId();
  const titleErrorId = useId();
  const parsedTmdbId = parseTmdbId(tmdbId);
  const invalidTitle = attempted && !title.trim();

  return (
    <Dialog
      describedBy={dialogDescriptionId}
      initialFocus={titleInputRef}
      labelledBy={dialogTitleId}
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="font-display text-2xl font-bold text-cream"
            id={dialogTitleId}
          >
            Add a movie
          </h2>
          <p
            className="mt-2 text-sm leading-6 text-zinc-400"
            id={dialogDescriptionId}
          >
            Search TMDB, enter an exact TMDB ID, or add the title without a
            match.
          </p>
        </div>
        <Button aria-label="Close add movie" onClick={onClose} variant="ghost">
          <X size={18} />
        </Button>
      </div>

      <div className="mt-6 grid gap-4">
        <TmdbMovieFields
          onAuthExpired={onAuthExpired}
          onTitleChange={setTitle}
          onTmdbIdChange={setTmdbId}
          title={title}
          titleErrorId={titleErrorId}
          titleInputRef={titleInputRef}
          titleInvalid={invalidTitle}
          tmdbId={tmdbId}
        />
        {invalidTitle && (
          <p className="text-sm text-red-200" id={titleErrorId} role="alert">
            Enter a movie title.
          </p>
        )}
        <label className="sr-only" htmlFor={franchiseId}>
          Series or franchise (optional)
        </label>
        <Input
          id={franchiseId}
          value={franchiseName}
          onChange={(event) => setFranchiseName(event.target.value)}
          placeholder="Series / franchise (optional)"
        />
      </div>

      {title && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-curtain/35 pt-5">
          <p className="text-sm text-zinc-400">
            A TMDB match is optional. Any supplied ID is validated before the
            movie is saved.
          </p>
          <Button
            disabled={busy || parsedTmdbId === undefined}
            onClick={() => {
              setAttempted(true);
              if (!title.trim() || parsedTmdbId === undefined) return;
              void run(
                () =>
                  api.addMovie({
                    title,
                    franchiseName,
                    tmdbId: parsedTmdbId,
                  }),
                onClose,
              );
            }}
          >
            <Plus size={16} />
            Add movie
          </Button>
        </div>
      )}
    </Dialog>
  );
}
