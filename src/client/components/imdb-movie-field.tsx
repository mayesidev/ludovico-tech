import { useId } from "react";
import { parseImdbId } from "../../shared/imdb";
import { Input } from "./ui";

export function ImdbMovieField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  const parsedImdbId = parseImdbId(value);
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;

  return (
    <div>
      <label
        className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500"
        htmlFor={inputId}
      >
        IMDb ID or URL (optional)
      </label>
      <Input
        aria-describedby={parsedImdbId === undefined ? errorId : helpId}
        aria-invalid={parsedImdbId === undefined}
        className="mt-2"
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        placeholder="tt0117509 or an IMDb title URL"
        value={value}
      />
      {parsedImdbId === undefined ? (
        <span
          className="mt-2 block text-sm font-normal normal-case tracking-normal text-red-200"
          id={errorId}
          role="alert"
        >
          Enter an IMDb ID or IMDb title URL.
        </span>
      ) : (
        <span
          className="mt-2 block text-xs font-normal normal-case tracking-normal text-zinc-500"
          id={helpId}
        >
          Used only for an external link. TMDB remains the source for movie
          data.
        </span>
      )}
    </div>
  );
}
