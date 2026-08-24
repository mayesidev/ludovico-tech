import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type TmdbRefreshStatus } from "../api";
import type { Navigate } from "../types";
import { AppLink } from "./app-link";
import { Badge, Button, Card, SectionHeading } from "./ui";

const formatTimestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Never";

const stateLabel: Record<TmdbRefreshStatus["items"][number]["state"], string> =
  {
    current: "Current",
    due: "Due",
    failed: "Failed",
    never_fetched: "Never fetched",
    version_stale: "Version stale",
  };

export function TmdbStatusPage({
  canMutate,
  onNavigate,
}: {
  canMutate: boolean;
  onNavigate: Navigate;
}) {
  const [status, setStatus] = useState<TmdbRefreshStatus | null>(null);
  const [loading, setLoading] = useState(canMutate);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canMutate) return;
    try {
      setStatus(await api.tmdbRefreshStatus());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load TMDB refresh status",
      );
    } finally {
      setLoading(false);
    }
  }, [canMutate]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!status) return;
    const interval = window.setInterval(
      () => void load(),
      status.schedule.running ? 1500 : 15_000,
    );
    return () => window.clearInterval(interval);
  }, [load, status]);

  if (!canMutate) {
    return (
      <div className="py-16 text-center">
        <h1 className="font-heading text-3xl text-text-primary">
          TMDB Refresh Status
        </h1>
        <p className="mt-4 text-text-muted">
          Sign in to view or run TMDB refresh operations.
        </p>
      </div>
    );
  }

  if (loading || !status) {
    return <p className="py-16 text-center text-text-muted">Loading status…</p>;
  }

  const { schedule, counts } = status;
  return (
    <article className="space-y-10 py-4 sm:py-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading
          eyebrow="Operations"
          title="TMDB Refresh Status"
          description="The 15-minute heartbeat runs a bounded batch only when this schedule is due."
        />
        <Button
          disabled={starting || schedule.running || !schedule.enabled}
          onClick={() => {
            setStarting(true);
            setError(null);
            void api
              .runTmdbRefresh()
              .then(load)
              .catch((cause) =>
                setError(
                  cause instanceof Error ? cause.message : "Refresh failed",
                ),
              )
              .finally(() => setStarting(false));
          }}
        >
          <RefreshCw
            className={schedule.running ? "animate-spin" : undefined}
            size={16}
          />
          {schedule.running ? "Refresh running" : "Run now"}
        </Button>
      </div>

      {error && (
        <p className="rounded-sm border border-danger/50 bg-danger-surface px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Linked", counts.linked],
          ["Pending", counts.pending],
          ["Current", counts.current],
          ["Failed", counts.failed],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="ui-label text-text-muted">{label}</p>
            <p className="mt-2 font-heading text-3xl text-text-primary">
              {value}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{schedule.enabled ? "Enabled" : "Disabled"}</Badge>
          <span className="text-sm text-text-muted">
            Data version {status.currentDataVersion} · Batch{" "}
            {schedule.batchSize} · Every {schedule.intervalMinutes} minutes
          </span>
        </div>
        <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="ui-label text-text-muted">Next run</dt>
            <dd className="mt-2 text-text-primary">
              {formatTimestamp(schedule.nextRunAt)}
            </dd>
          </div>
          <div>
            <dt className="ui-label text-text-muted">Last completed</dt>
            <dd className="mt-2 text-text-primary">
              {formatTimestamp(schedule.lastCompletedAt)}
            </dd>
          </div>
          <div>
            <dt className="ui-label text-text-muted">Last result</dt>
            <dd className="mt-2 text-text-primary">
              {schedule.lastRefreshed} refreshed, {schedule.lastFailed} failed
            </dd>
          </div>
          <div>
            <dt className="ui-label text-text-muted">Remaining after run</dt>
            <dd className="mt-2 text-text-primary">{schedule.lastRemaining}</dd>
          </div>
        </dl>
        {(schedule.lastError || schedule.lastRateLimited) && (
          <p className="mt-5 text-sm text-danger">
            {schedule.lastError ?? "The last run was rate limited."}
          </p>
        )}
      </Card>

      <section>
        <SectionHeading
          eyebrow="Queue"
          title="Linked titles"
          description="Pending work is listed first. Successful fetch times come from the provider snapshot persisted by the Worker."
        />
        <div className="overflow-x-auto rounded-sm border border-border-subtle">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-interactive text-text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">State</th>
                <th className="px-4 py-3 font-semibold">Fetched</th>
                <th className="px-4 py-3 font-semibold">Last attempt</th>
                <th className="px-4 py-3 font-semibold">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {status.items.map((item) => (
                <tr key={item.movieId}>
                  <td className="px-4 py-3">
                    <AppLink
                      className="font-semibold text-highlight-soft hover:text-text-primary"
                      href={`/movies/${encodeURIComponent(item.movieId)}?from=library`}
                      onNavigate={onNavigate}
                    >
                      {item.title}
                    </AppLink>
                    <span className="ml-2 text-xs text-text-muted">
                      TMDB {item.tmdbId}
                    </span>
                    {item.lastError && (
                      <span className="mt-1 block text-xs text-danger">
                        {item.lastError}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {stateLabel[item.state]}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatTimestamp(item.fetchedAt)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatTimestamp(item.lastAttemptAt)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {item.dataVersion}/{status.currentDataVersion}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {status.truncated && (
          <p className="mt-3 text-sm text-text-muted">
            Showing the first {status.items.length} linked titles.
          </p>
        )}
      </section>
    </article>
  );
}
