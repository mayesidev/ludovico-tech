import { LoaderCircle, Plus, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { parseImdbId } from "../../shared/imdb";
import { api, type MovieDetail } from "../api";
import {
  parseVersionReferenceUrl,
  parseVersionRuntime,
} from "../lib/movie-version";
import { parseTmdbId } from "../lib/tmdb-id";
import type { RunAction } from "../types";
import { CollectionNameField } from "./collection-name-field";
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

export function AddMovieDialog({
  busy,
  notice,
  onAuthExpired,
  onClose,
  onCreated,
  run,
}: {
  busy: boolean;
  notice?: ReactNode;
  onAuthExpired: () => Promise<void>;
  onClose: () => void;
  onCreated: (movie: MovieDetail) => void;
  run: RunAction;
}) {
  const [title, setTitle] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [tmdbId, setTmdbId] = useState("");
  const [versionSpecified, setVersionSpecified] = useState(false);
  const [version, setVersion] = useState("");
  const [versionRuntime, setVersionRuntime] = useState("");
  const [versionReferenceUrl, setVersionReferenceUrl] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [adding, setAdding] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleErrorId = useId();
  const parsedTmdbId = parseTmdbId(tmdbId);
  const parsedImdbId = parseImdbId(imdbId);
  const parsedVersionRuntime = parseVersionRuntime(versionRuntime);
  const parsedVersionReferenceUrl =
    parseVersionReferenceUrl(versionReferenceUrl);
  const usingVersion =
    parsedTmdbId !== null && parsedTmdbId !== undefined && versionSpecified;
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
      <DialogContent initialFocus={titleInputRef}>
        {notice}
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>Add a Movie</DialogTitle>
            <DialogDescription className="mt-2">
              Search TMDB, enter an exact TMDB ID, or add the title without a
              match.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close Add Movie"
            render={<Button variant="ghost" />}
          >
            <X size={18} />
          </DialogClose>
        </div>

        <div className="mt-6 grid gap-4">
          <TmdbMovieFields
            onAuthExpired={onAuthExpired}
            onTitleChange={setTitle}
            onTmdbIdChange={changeTmdbId}
            title={title}
            titleErrorId={titleErrorId}
            titleInputRef={titleInputRef}
            titleInvalid={invalidTitle}
            tmdbId={tmdbId}
          />
          {invalidTitle && (
            <p className="text-sm text-danger" id={titleErrorId} role="alert">
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
            tmdbSelected={parsedTmdbId !== null && parsedTmdbId !== undefined}
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
          <CollectionNameField
            onChange={setCollectionName}
            value={collectionName}
          />
        </div>

        {title && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border-subtle pt-5">
            <p className="text-sm text-text-muted">
              A TMDB match is optional. Any supplied ID is validated before the
              movie is saved.
            </p>
            <Button
              disabled={
                adding ||
                busy ||
                parsedImdbId === undefined ||
                parsedTmdbId === undefined
              }
              onClick={() => {
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
                let createdMovie: MovieDetail | null = null;
                setAdding(true);
                void run(async () => {
                  const result = await api.addMovie({
                    title,
                    collectionName,
                    imdbId: parsedImdbId,
                    tmdbId: parsedTmdbId,
                    version: usingVersion ? version.trim() : null,
                    versionRuntime: usingVersion ? parsedVersionRuntime : null,
                    versionReferenceUrl: usingVersion
                      ? parsedVersionReferenceUrl
                      : null,
                  });
                  createdMovie = result.movie;
                }).then(() => {
                  setAdding(false);
                  if (!createdMovie) return;
                  onCreated(createdMovie);
                  onClose();
                });
              }}
            >
              {adding ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {adding ? "Adding…" : "Add Movie"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
