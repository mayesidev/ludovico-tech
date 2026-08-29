import type { AuditAttribution } from "../api";
import { cn, formatTimestamp } from "../lib/utils";

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
    <details className={cn("group", className)}>
      <summary className="w-fit cursor-pointer list-none text-sm font-semibold text-highlight-soft underline decoration-highlight-soft/45 underline-offset-4 hover:text-text-primary [&::-webkit-details-marker]:hidden">
        History
      </summary>
      <section
        aria-label="Activity attribution"
        className="mt-3 rounded-sm border border-border-subtle bg-canvas/35 px-4 py-3"
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
      </section>
    </details>
  );
}
