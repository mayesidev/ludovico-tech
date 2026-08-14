import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import {
  parseVersionReferenceUrl,
  parseVersionRuntime,
} from "../lib/movie-version";
import { parseTmdbId } from "../lib/tmdb-id";
import { parseImdbId } from "../../shared/imdb";
import type { RunAction } from "../types";
import { Dialog } from "./dialog";
import { ImdbMovieField } from "./imdb-movie-field";
import { MovieVersionFields } from "./movie-version-fields";
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
  const [collectionName, setCollectionName] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [tmdbId, setTmdbId] = useState("");
  const [versionSpecified, setVersionSpecified] = useState(false);
  const [version, setVersion] = useState("");
  const [versionRuntime, setVersionRuntime] = useState("");
  const [versionReferenceUrl, setVersionReferenceUrl] = useState("");
  const [attempted, setAttempted] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const collectionId = useId();
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
          onTmdbIdChange={changeTmdbId}
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
        <label className="sr-only" htmlFor={collectionId}>
          Collection (optional)
        </label>
        <Input
          id={collectionId}
          value={collectionName}
          onChange={(event) => setCollectionName(event.target.value)}
          placeholder="Collection (optional)"
        />
      </div>

      {title && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-curtain/35 pt-5">
          <p className="text-sm text-zinc-400">
            A TMDB match is optional. Any supplied ID is validated before the
            movie is saved.
          </p>
          <Button
            disabled={
              busy || parsedImdbId === undefined || parsedTmdbId === undefined
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
              void run(
                () =>
                  api.addMovie({
                    title,
                    collectionName,
                    imdbId: parsedImdbId,
                    tmdbId: parsedTmdbId,
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
            <Plus size={16} />
            Add movie
          </Button>
        </div>
      )}
    </Dialog>
  );
}
