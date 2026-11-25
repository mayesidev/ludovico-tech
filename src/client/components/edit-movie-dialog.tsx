import { Pencil, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { parseImdbId } from "../../shared/imdb";
import type { Movie } from "../api";
import { api } from "../api";
import {
  parseVersionReferenceUrl,
  parseVersionRuntime,
} from "../lib/movie-version";
import { parseTmdbId } from "../lib/tmdb-id";
import type { RunAction } from "../types";
import { ImdbMovieField } from "./imdb-movie-field";
import { MovieVersionFields } from "./movie-version-fields";
import { TmdbMovieFields } from "./tmdb-movie-fields";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function EditMovieDialog({
  busy,
  movie,
  notice,
  onAuthExpired,
  onClose,
  run,
}: {
  busy: boolean;
  movie: Movie;
  notice?: ReactNode;
  onAuthExpired: () => Promise<void>;
  onClose: () => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState(movie.title);
  const [collectionName, setCollectionName] = useState(
    movie.collection_name ?? "",
  );
  const [imdbId, setImdbId] = useState(movie.imdb_id ?? "");
  const [tmdbId, setTmdbId] = useState(
    movie.tmdb_id === null ? "" : String(movie.tmdb_id),
  );
  const [versionSpecified, setVersionSpecified] = useState(
    movie.version !== null,
  );
  const [version, setVersion] = useState(movie.version ?? "");
  const [versionRuntime, setVersionRuntime] = useState(
    movie.version_runtime === null ? "" : String(movie.version_runtime),
  );
  const [versionReferenceUrl, setVersionReferenceUrl] = useState(
    movie.version_reference_url ?? "",
  );
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const collectionId = useId();
  const parsedTmdbId = parseTmdbId(tmdbId);
  const parsedImdbId = parseImdbId(imdbId);
  const parsedVersionRuntime = parseVersionRuntime(versionRuntime);
  const parsedVersionReferenceUrl =
    parseVersionReferenceUrl(versionReferenceUrl);
  const tmdbSelected = typeof parsedTmdbId === "number";
  const usingVersion = tmdbSelected && versionSpecified;
  const invalidTitle = attempted && !title.trim();

  const changeTmdbId = (value: string) => {
    if (parseTmdbId(value) !== parsedTmdbId) {
      setVersionSpecified(false);
      setVersion("");
      setVersionRuntime("");
      setVersionReferenceUrl("");
    }
    setTmdbId(value);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent initialFocus={inputRef}>
        {notice}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (
              !title.trim() ||
              parsedImdbId === undefined ||
              parsedTmdbId === undefined ||
              (usingVersion &&
                (!version.trim() ||
                  parsedVersionRuntime === undefined ||
                  parsedVersionReferenceUrl === undefined))
            )
              return;
            const titleChanged = title.trim() !== movie.title;
            const tmdbChanged = parsedTmdbId !== movie.tmdb_id;
            void run(
              () =>
                api.updateMovie(movie.id, {
                  collectionName,
                  imdbId: parsedImdbId,
                  title,
                  tmdbId:
                    titleChanged || tmdbChanged ? parsedTmdbId : undefined,
                  version: usingVersion ? version.trim() : null,
                  versionRuntime: usingVersion ? parsedVersionRuntime : null,
                  versionReferenceUrl: usingVersion
                    ? parsedVersionReferenceUrl
                    : null,
                }),
              onClose,
            );
          }}
        >
          <div className="mb-6 flex items-start justify-between">
            <div>
              <DialogTitle>Edit Movie</DialogTitle>
              <DialogDescription className="mt-2">
                Update the catalog title, collection, or external movie
                references.
              </DialogDescription>
            </div>
            <DialogClose
              aria-label="Close Edit Dialog"
              render={<Button labelStyle="plain" size="bare" variant="text" />}
            >
              <X />
            </DialogClose>
          </div>

          <div className="space-y-4">
            <TmdbMovieFields
              onAuthExpired={onAuthExpired}
              onTitleChange={setTitle}
              onTmdbIdChange={changeTmdbId}
              title={title}
              titleErrorId={errorId}
              titleInputRef={inputRef}
              titleInvalid={invalidTitle}
              tmdbId={tmdbId}
            />
            {invalidTitle && (
              <p className="mt-2 text-sm text-danger" id={errorId} role="alert">
                Enter a movie title.
              </p>
            )}
            <ImdbMovieField onChange={setImdbId} value={imdbId} />
            <MovieVersionFields
              attempted={attempted}
              onSpecifiedChange={setVersionSpecified}
              onVersionChange={setVersion}
              onVersionReferenceUrlChange={setVersionReferenceUrl}
              onVersionRuntimeChange={setVersionRuntime}
              specified={versionSpecified}
              tmdbSelected={tmdbSelected}
              version={version}
              versionReferenceUrl={versionReferenceUrl}
              versionReferenceUrlInvalid={
                usingVersion && parsedVersionReferenceUrl === undefined
              }
              versionRuntime={versionRuntime}
              versionRuntimeInvalid={
                usingVersion && parsedVersionRuntime === undefined
              }
            />
            <label className="ui-label block text-text-muted">
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
            <DialogClose render={<Button variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={
                busy || parsedImdbId === undefined || parsedTmdbId === undefined
              }
              type="submit"
            >
              <Pencil size={16} />
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
