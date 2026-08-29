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
    <section
      aria-label="Activity attribution"
      className={cn(
        "rounded-sm border border-border-subtle bg-canvas/35 px-4 py-3",
        className,
      )}
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
  );
}
