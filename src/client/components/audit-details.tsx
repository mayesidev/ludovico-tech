import type { AuditAttribution } from "../api";
import { formatTimestamp } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

type AuditDetailsProps = {
  className?: string;
  entries: Array<{
    attribution: AuditAttribution;
    label: string;
  }>;
};

export function AuditDetails({ className, entries }: AuditDetailsProps) {
  const visibleEntries = entries.filter(
    ({ attribution }) => attribution.at !== null || attribution.by !== null,
  );
  if (visibleEntries.length === 0) return null;

  return (
    <Collapsible className={className}>
      <CollapsibleTrigger
        render={<Button labelStyle="plain" size="bare" variant="link" />}
      >
        History
      </CollapsibleTrigger>
      <CollapsibleContent
        aria-label="Activity attribution"
        className="mt-3"
        keepMounted
        render={<section />}
      >
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          {visibleEntries.map(({ attribution, label }) => (
            <div key={label}>
              <dt className="ui-label text-text-muted">{label}</dt>
              <dd className="mt-1 text-text-secondary">
                {formatTimestamp(attribution.at)}
                {attribution.by ? ` · ${attribution.by}` : " · Unknown user"}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
