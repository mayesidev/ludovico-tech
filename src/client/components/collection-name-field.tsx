import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "../api";
import { Input } from "./ui";

export function CollectionNameField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const [collections, setCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const requestSequence = useRef(0);
  const inputId = useId();
  const suggestionsId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const search = value.trim();
    const sequence = ++requestSequence.current;
    if (!search) return;

    const timeout = window.setTimeout(() => {
      setSearching(true);
      void api
        .collectionSuggestions(search)
        .then((result) => {
          if (sequence === requestSequence.current) {
            setCollections(result.collections);
          }
        })
        .catch(() => {
          if (sequence === requestSequence.current) setCollections([]);
        })
        .finally(() => {
          if (sequence === requestSequence.current) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [value]);

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={inputId}>
        Collection (optional)
      </label>
      <span className="sr-only" id={descriptionId}>
        Choose an existing collection or enter a new collection name.
      </span>
      <Input
        aria-describedby={descriptionId}
        className="pr-10"
        id={inputId}
        list={suggestionsId}
        onChange={(event) => {
          requestSequence.current += 1;
          setCollections([]);
          setSearching(false);
          onChange(event.target.value);
        }}
        placeholder="Collection (optional)"
        value={value}
      />
      <datalist id={suggestionsId}>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.name} />
        ))}
      </datalist>
      {searching && (
        <LoaderCircle
          aria-label="Finding collections"
          className="absolute right-3 top-3 animate-spin text-text-muted"
          size={18}
        />
      )}
    </div>
  );
}
