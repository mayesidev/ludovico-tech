import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "./ui/combobox";
import { Label } from "./ui/label";

type CollectionSuggestion = { id: string; name: string };

export function CollectionNameField({
  label,
  onChange,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [collections, setCollections] = useState<CollectionSuggestion[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [suggestionsRequested, setSuggestionsRequested] = useState(false);
  const requestSequence = useRef(0);
  const inputId = useId();
  const descriptionId = useId();
  const fieldLabel = label ?? "Collection (optional)";
  const suggestionsOpen = suggestionsRequested && collections.length > 0;

  useEffect(() => {
    const search = query.trim();
    const sequence = ++requestSequence.current;
    if (!search) return;

    const timeout = window.setTimeout(() => {
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
    return () => {
      requestSequence.current += 1;
      window.clearTimeout(timeout);
    };
  }, [query]);

  return (
    <Combobox<CollectionSuggestion>
      filter={null}
      inputValue={value}
      items={collections}
      itemToStringLabel={(collection) => collection.name}
      open={suggestionsOpen}
      onOpenChange={setSuggestionsRequested}
      onInputValueChange={(next, { reason }) => {
        if (reason !== "input-change" && reason !== "item-press") return;
        const nextQuery = reason === "item-press" ? "" : next;
        requestSequence.current += 1;
        setCollections([]);
        setSearching(Boolean(nextQuery.trim()));
        setQuery(nextQuery);
        onChange(next);
      }}
    >
      <div>
        <Label
          className={label ? "mb-2" : "sr-only"}
          htmlFor={inputId}
          variant={label ? "field" : "default"}
        >
          {fieldLabel}
        </Label>
        <span className="sr-only" id={descriptionId}>
          Choose an existing collection or enter a new collection name.
        </span>
        <div className="relative">
          <ComboboxInput
            aria-busy={searching}
            aria-describedby={descriptionId}
            aria-label={fieldLabel}
            id={inputId}
            onBlur={() => {
              if (!suggestionsOpen) setSuggestionsRequested(false);
            }}
            placeholder={label ? "Optional" : fieldLabel}
          />
          {searching && (
            <LoaderCircle
              aria-hidden="true"
              className="pointer-events-none absolute top-3 right-3 animate-spin text-text-muted"
              size={18}
            />
          )}
        </div>
        <ComboboxContent>
          <ComboboxList>
            {(collection: CollectionSuggestion) => (
              <ComboboxItem key={collection.id} value={collection}>
                {collection.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </div>
    </Combobox>
  );
}
