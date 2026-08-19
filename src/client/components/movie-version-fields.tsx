import { useId } from "react";
import { Input } from "./ui";

type MovieVersionFieldsProps = {
  attempted: boolean;
  onSpecifiedChange: (specified: boolean) => void;
  onVersionChange: (version: string) => void;
  onVersionReferenceUrlChange: (url: string) => void;
  onVersionRuntimeChange: (runtime: string) => void;
  specified: boolean;
  tmdbSelected: boolean;
  version: string;
  versionReferenceUrl: string;
  versionReferenceUrlInvalid: boolean;
  versionRuntime: string;
  versionRuntimeInvalid: boolean;
};

export function MovieVersionFields({
  attempted,
  onSpecifiedChange,
  onVersionChange,
  onVersionReferenceUrlChange,
  onVersionRuntimeChange,
  specified,
  tmdbSelected,
  version,
  versionReferenceUrl,
  versionReferenceUrlInvalid,
  versionRuntime,
  versionRuntimeInvalid,
}: MovieVersionFieldsProps) {
  const toggleId = useId();
  const versionId = useId();
  const versionErrorId = useId();
  const runtimeId = useId();
  const runtimeErrorId = useId();
  const referenceId = useId();
  const referenceErrorId = useId();
  const versionEnabled = specified && tmdbSelected;
  const detailsEnabled = versionEnabled && Boolean(version.trim());
  const versionInvalid = attempted && versionEnabled && !version.trim();

  return (
    <section className="rounded-sm border border-border-subtle bg-canvas/35 p-4">
      <label
        className="flex cursor-pointer items-start gap-3 text-sm text-text-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
        htmlFor={toggleId}
      >
        <input
          checked={specified && tmdbSelected}
          className="mt-0.5 size-4 accent-highlight"
          disabled={!tmdbSelected}
          id={toggleId}
          onChange={(event) => onSpecifiedChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block font-semibold">Specify a version</span>
          <span className="mt-1 block leading-5 text-text-muted">
            Optional. Select a TMDB movie first, then identify a particular cut,
            edition, release, or fan edit.
          </span>
        </span>
      </label>

      {versionEnabled && (
        <div className="mt-4 grid gap-4 border-t border-border-subtle pt-4">
          <label className="ui-label block text-text-muted" htmlFor={versionId}>
            Version
            <Input
              aria-describedby={versionInvalid ? versionErrorId : undefined}
              aria-invalid={versionInvalid}
              className="mt-2"
              id={versionId}
              maxLength={120}
              onChange={(event) => onVersionChange(event.target.value)}
              placeholder="Director's Cut"
              value={version}
            />
          </label>
          {versionInvalid && (
            <p className="text-sm text-danger" id={versionErrorId} role="alert">
              Enter the version name.
            </p>
          )}

          <label className="ui-label block text-text-muted" htmlFor={runtimeId}>
            Version Runtime (minutes)
            <Input
              aria-describedby={
                attempted && versionRuntimeInvalid ? runtimeErrorId : undefined
              }
              aria-invalid={attempted && versionRuntimeInvalid}
              className="mt-2"
              disabled={!detailsEnabled}
              id={runtimeId}
              inputMode="numeric"
              min={1}
              onChange={(event) => onVersionRuntimeChange(event.target.value)}
              placeholder="Optional"
              step={1}
              type="number"
              value={versionRuntime}
            />
          </label>
          {attempted && versionRuntimeInvalid && (
            <p className="text-sm text-danger" id={runtimeErrorId} role="alert">
              Enter a positive whole number of minutes.
            </p>
          )}

          <label
            className="ui-label block text-text-muted"
            htmlFor={referenceId}
          >
            Version Reference URL
            <Input
              aria-describedby={
                attempted && versionReferenceUrlInvalid
                  ? referenceErrorId
                  : undefined
              }
              aria-invalid={attempted && versionReferenceUrlInvalid}
              className="mt-2"
              disabled={!detailsEnabled}
              id={referenceId}
              maxLength={2048}
              onChange={(event) =>
                onVersionReferenceUrlChange(event.target.value)
              }
              placeholder="https://…"
              type="url"
              value={versionReferenceUrl}
            />
          </label>
          {attempted && versionReferenceUrlInvalid && (
            <p
              className="text-sm text-danger"
              id={referenceErrorId}
              role="alert"
            >
              Enter an HTTP or HTTPS URL.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
