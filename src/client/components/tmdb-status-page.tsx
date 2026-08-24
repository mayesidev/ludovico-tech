import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  api,
  type TmdbRefreshItem,
  type TmdbRefreshQueueQuery,
  type TmdbRefreshQueueResponse,
  type TmdbRefreshSummary,
} from "../api";
import type { Navigate } from "../types";
import { AppLink } from "./app-link";
import { Button, Card, Input } from "./ui";

const formatTimestamp = (value: string | null, fallback = "Never") =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : fallback;

const formatDueTimestamp = (value: string | null) =>
  value && new Date(value).getTime() > Date.now()
    ? formatTimestamp(value)
    : value
      ? "Due now"
      : "—";

const formatInterval = (minutes: number) => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return [
    days > 0 ? `${days} day${days === 1 ? "" : "s"}` : null,
    hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : null,
    remainingMinutes > 0
      ? `${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
};

const stateLabel: Record<TmdbRefreshItem["state"], string> = {
  current: "Current",
  due: "Due",
  failed: "Failed",
  never_fetched: "Never fetched",
  unlinked: "Not linked",
  version_stale: "Version stale",
};

const initialQueueQuery: TmdbRefreshQueueQuery = {
  dateSearch: "",
  direction: "asc",
  page: 1,
  pageSize: 50,
  search: "",
  sort: "state",
  state: "all",
};

const dateSearchValue = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
};

export function TmdbStatusPage({
  canMutate,
  onNavigate,
}: {
  canMutate: boolean;
  onNavigate: Navigate;
}) {
  const [summary, setSummary] = useState<TmdbRefreshSummary | null>(null);
  const [queue, setQueue] = useState<TmdbRefreshQueueResponse | null>(null);
  const [loading, setLoading] = useState(canMutate);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [updatingSchedule, setUpdatingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [queueQuery, setQueueQuery] = useState(initialQueueQuery);
  const [intervalMinutesInput, setIntervalMinutesInput] = useState<
    string | null
  >(null);
  const [batchSizeInput, setBatchSizeInput] = useState<string | null>(null);
  const summaryRequestSequence = useRef(0);
  const queueRequestSequence = useRef(0);

  const loadSummary = useCallback(async () => {
    if (!canMutate) return;
    const sequence = ++summaryRequestSequence.current;
    try {
      const response = await api.tmdbRefreshSummary();
      if (sequence !== summaryRequestSequence.current) return;
      setSummary(response);
      setError(null);
    } catch (cause) {
      if (sequence !== summaryRequestSequence.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load Library refresh status",
      );
    } finally {
      if (sequence === summaryRequestSequence.current) setLoading(false);
    }
  }, [canMutate]);

  const loadQueue = useCallback(async () => {
    if (!canMutate) return;
    const sequence = ++queueRequestSequence.current;
    setRefreshing(true);
    try {
      const response = await api.tmdbRefreshQueue(queueQuery);
      if (sequence !== queueRequestSequence.current) return;
      setQueue(response);
      setError(null);
    } catch (cause) {
      if (sequence !== queueRequestSequence.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load the refresh queue",
      );
    } finally {
      if (sequence === queueRequestSequence.current) setRefreshing(false);
    }
  }, [canMutate, queueQuery]);

  const load = useCallback(async () => {
    await Promise.all([loadSummary(), loadQueue()]);
  }, [loadQueue, loadSummary]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQueueQuery((current) =>
        current.search === filter
          ? current
          : {
              ...current,
              dateSearch: dateSearchValue(filter),
              page: 1,
              search: filter,
            },
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filter]);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);

  useEffect(() => {
    void Promise.resolve().then(loadQueue);
  }, [loadQueue]);

  const hasStatus = summary !== null && queue !== null;
  useEffect(() => {
    if (!hasStatus) return;
    const refreshOnFocus = () => void load();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [hasStatus, load]);

  if (!canMutate) {
    return (
      <div>
        <h1 className="font-heading text-3xl font-medium leading-none tracking-[0.01em] text-text-primary sm:text-4xl">
          Manager's Office
        </h1>
        <p className="mt-3 text-sm text-text-muted">
          Sign in to view or run Library update operations.
        </p>
      </div>
    );
  }

  if (loading || !summary || !queue) {
    return <p className="text-text-muted">Loading refresh data…</p>;
  }

  const { schedule, counts } = summary;
  const intervalMinutes =
    intervalMinutesInput ?? String(schedule.intervalMinutes);
  const batchSize = batchSizeInput ?? String(schedule.batchSize);
  const parsedIntervalMinutes = Number(intervalMinutes);
  const parsedBatchSize = Number(batchSize);
  const scheduleValuesAreValid =
    Number.isInteger(parsedIntervalMinutes) &&
    parsedIntervalMinutes >= 15 &&
    parsedIntervalMinutes <= 10080 &&
    Number.isInteger(parsedBatchSize) &&
    parsedBatchSize >= 1 &&
    parsedBatchSize <= 50;
  const scheduleHasChanges =
    parsedIntervalMinutes !== schedule.intervalMinutes ||
    parsedBatchSize !== schedule.batchSize;
  const changeSort = (sort: TmdbRefreshQueueQuery["sort"]) => {
    setQueueQuery((current) => ({
      ...current,
      direction:
        current.sort === sort
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : "asc",
      page: 1,
      sort,
    }));
  };
  const sortHeader = (label: string, sort: TmdbRefreshQueueQuery["sort"]) => {
    const active = queueQuery.sort === sort;
    return (
      <th
        aria-sort={
          active
            ? queueQuery.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className="border-r border-highlight/10 px-5 py-4 font-semibold last:border-r-0"
      >
        <button
          className="text-text-primary hover:text-highlight-soft"
          onClick={() => changeSort(sort)}
        >
          {label}
          {active ? (queueQuery.direction === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  };
  const { page, pageSize, total, totalPages } = queue.pagination;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  return (
    <div>
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-3xl font-medium leading-none tracking-[0.01em] text-text-primary sm:text-4xl">
            Manager's Office
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={refreshing}
            onClick={() => void load()}
            variant="secondary"
          >
            <RefreshCw
              className={refreshing ? "animate-spin" : undefined}
              size={16}
            />
            Refresh status
          </Button>
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
      </div>

      {error && (
        <p className="mb-6 rounded-sm border border-danger/50 bg-danger-surface px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Card className="mb-8 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-border-subtle sm:grid-cols-5 sm:divide-y-0">
          {[
            ["Linked", counts.linked],
            ["Not linked (excluded)", counts.unlinked],
            ["Pending", counts.pending],
            ["Current", counts.current],
            ["Failed", counts.failed],
          ].map(([label, value]) => (
            <div className="px-5 py-4" key={label}>
              <p className="ui-label text-text-muted">{label}</p>
              <p className="mt-1 font-heading text-2xl text-text-primary">
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="ui-label text-text-primary">Automatic updates</p>
              <p className="mt-1 text-sm text-text-muted">
                {schedule.enabled
                  ? `Runs every ${formatInterval(schedule.intervalMinutes)} in batches of ${schedule.batchSize}.`
                  : "Paused. No scheduled batches will start."}
              </p>
            </div>
            <Button
              disabled={updatingSchedule}
              onClick={() => {
                setUpdatingSchedule(true);
                setError(null);
                void api
                  .updateTmdbRefreshSchedule({ enabled: !schedule.enabled })
                  .then(load)
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Unable to update automatic refresh",
                    ),
                  )
                  .finally(() => setUpdatingSchedule(false));
              }}
              variant="secondary"
            >
              {schedule.enabled
                ? "Pause automatic updates"
                : "Resume automatic updates"}
            </Button>
          </div>
          <form
            className="mt-5 grid gap-4 border-t border-border-subtle pt-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!scheduleValuesAreValid || !scheduleHasChanges) return;
              setUpdatingSchedule(true);
              setError(null);
              void api
                .updateTmdbRefreshSchedule({
                  batchSize: parsedBatchSize,
                  intervalMinutes: parsedIntervalMinutes,
                })
                .then(() => {
                  setIntervalMinutesInput(null);
                  setBatchSizeInput(null);
                  return load();
                })
                .catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to save refresh schedule",
                  ),
                )
                .finally(() => setUpdatingSchedule(false));
            }}
          >
            <div className="text-sm text-text-secondary">
              <label
                className="ui-label mb-2 block text-text-muted"
                htmlFor="tmdb-refresh-frequency"
              >
                Frequency (minutes)
              </label>
              <Input
                aria-describedby="tmdb-refresh-frequency-help"
                aria-invalid={
                  intervalMinutes !== "" &&
                  (!Number.isInteger(parsedIntervalMinutes) ||
                    parsedIntervalMinutes < 15 ||
                    parsedIntervalMinutes > 10080)
                }
                max={10080}
                min={15}
                id="tmdb-refresh-frequency"
                onChange={(event) =>
                  setIntervalMinutesInput(event.target.value)
                }
                step={15}
                type="number"
                value={intervalMinutes}
              />
              <span
                className="mt-1.5 block text-xs text-text-muted"
                id="tmdb-refresh-frequency-help"
              >
                15 minutes to 7 days
              </span>
            </div>
            <div className="text-sm text-text-secondary">
              <label
                className="ui-label mb-2 block text-text-muted"
                htmlFor="tmdb-refresh-batch-size"
              >
                Batch size
              </label>
              <Input
                aria-describedby="tmdb-refresh-batch-size-help"
                aria-invalid={
                  batchSize !== "" &&
                  (!Number.isInteger(parsedBatchSize) ||
                    parsedBatchSize < 1 ||
                    parsedBatchSize > 50)
                }
                max={50}
                min={1}
                id="tmdb-refresh-batch-size"
                onChange={(event) => setBatchSizeInput(event.target.value)}
                step={1}
                type="number"
                value={batchSize}
              />
              <span
                className="mt-1.5 block text-xs text-text-muted"
                id="tmdb-refresh-batch-size-help"
              >
                1 to 50 titles per run
              </span>
            </div>
            <Button
              className="sm:col-span-2 lg:col-span-1 lg:mb-[1.375rem]"
              disabled={
                updatingSchedule ||
                !scheduleValuesAreValid ||
                !scheduleHasChanges
              }
              type="submit"
            >
              Save schedule
            </Button>
          </form>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="ui-label text-text-muted">Next run</dt>
              <dd className="mt-1 text-text-primary">
                {schedule.enabled
                  ? formatDueTimestamp(schedule.nextRunAt)
                  : "Paused"}
              </dd>
            </div>
            <div>
              <dt className="ui-label text-text-muted">Last completed</dt>
              <dd className="mt-1 text-text-primary">
                {formatTimestamp(schedule.lastCompletedAt)}
              </dd>
            </div>
            <div>
              <dt className="ui-label text-text-muted">Last result</dt>
              <dd className="mt-1 text-text-primary">
                {schedule.lastRefreshed} refreshed, {schedule.lastFailed} failed
              </dd>
            </div>
            <div>
              <dt className="ui-label text-text-muted">Remaining</dt>
              <dd className="mt-1 text-text-primary">
                {schedule.lastRemaining}
              </dd>
            </div>
          </dl>
          {(schedule.lastError || schedule.lastRateLimited) && (
            <p className="mt-4 text-sm text-danger">
              {schedule.lastError ?? "The last run was rate limited."}
            </p>
          )}
        </div>
      </Card>

      <div className="mb-5 flex flex-col justify-end gap-3 sm:flex-row sm:items-end">
        <label className="grid gap-1.5 text-xs text-text-muted">
          <span className="ui-label">Status</span>
          <select
            aria-label="Filter refresh status"
            className="h-11 rounded-sm border border-border-subtle bg-canvas/75 px-3 text-sm text-text-primary"
            value={queueQuery.state}
            onChange={(event) =>
              setQueueQuery((current) => ({
                ...current,
                page: 1,
                state: event.target.value as TmdbRefreshQueueQuery["state"],
              }))
            }
          >
            <option value="all">All statuses</option>
            <option value="current">Current</option>
            <option value="due">Due</option>
            <option value="failed">Failed</option>
            <option value="never_fetched">Never fetched</option>
            <option value="unlinked">Not linked</option>
            <option value="version_stale">Version stale</option>
          </select>
        </label>
        <div className="relative w-full sm:w-72">
          <Search
            className="absolute left-3 top-3.5 text-text-muted"
            size={16}
          />
          <label className="sr-only" htmlFor="tmdb-status-search">
            Search metadata refresh status
          </label>
          <Input
            className="pl-9"
            id="tmdb-status-search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search all fields…"
          />
        </div>
      </div>

      <Card aria-busy={refreshing} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="ui-label border-b border-highlight/15 bg-[#7a1d30] text-text-primary/80">
              <tr>
                {sortHeader("Title", "title")}
                {sortHeader("TMDB ID", "tmdbId")}
                {sortHeader("Status", "state")}
                {sortHeader("Last fetched", "fetchedAt")}
                {sortHeader("Last attempt", "lastAttemptAt")}
                {sortHeader("Refresh after", "refreshAfter")}
                {sortHeader(
                  `Data version (current: ${summary.currentDataVersion})`,
                  "dataVersion",
                )}
              </tr>
            </thead>
            <tbody className="data-surface divide-y divide-border-subtle">
              {queue.items.map((item) => (
                <tr
                  className="bg-canvas/35 transition hover:bg-action/15"
                  key={item.movieId}
                >
                  <td className="px-5 py-4 text-text-muted">
                    <AppLink
                      className="font-semibold text-text-primary hover:text-highlight-soft"
                      href={`/movies/${encodeURIComponent(item.movieId)}?from=manager-office`}
                      onNavigate={onNavigate}
                    >
                      {item.title}
                    </AppLink>
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {item.tmdbId ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    <span
                      className={
                        item.state === "failed"
                          ? "text-danger"
                          : item.state === "current"
                            ? "text-text-secondary"
                            : "text-highlight-soft"
                      }
                    >
                      {stateLabel[item.state]}
                      {item.lastError && (
                        <span className="mt-1 block max-w-64 text-xs text-danger">
                          {item.lastError}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {formatTimestamp(
                      item.fetchedAt,
                      item.state === "unlinked" ? "—" : "Never",
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {formatTimestamp(item.lastAttemptAt, "—")}
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {formatDueTimestamp(item.refreshAfter)}
                  </td>
                  <td className="px-5 py-4 text-text-muted">
                    {item.dataVersion === null
                      ? "—"
                      : `${item.dataVersion}/${summary.currentDataVersion}`}
                  </td>
                </tr>
              ))}
              {!refreshing && queue.items.length === 0 && (
                <tr>
                  <td
                    className="px-5 py-8 text-center text-text-muted"
                    colSpan={7}
                  >
                    No Library titles match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-4 border-t border-action/45 bg-action/10 px-5 py-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            {rangeStart}–{rangeEnd} of {total} Library titles
            {refreshing ? " · Updating…" : ""}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <span>Rows per page</span>
              <select
                aria-label="Manager's Office rows per page"
                className="h-9 rounded-sm border border-border-primary bg-canvas px-2 text-text-primary"
                value={queueQuery.pageSize}
                onChange={(event) =>
                  setQueueQuery((current) => ({
                    ...current,
                    page: 1,
                    pageSize: Number(event.target.value) as 25 | 50 | 100,
                  }))
                }
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              aria-label="Previous Manager's Office page"
              className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
              disabled={refreshing || page <= 1}
              onClick={() =>
                setQueueQuery((current) => ({
                  ...current,
                  page: page - 1,
                }))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="Next Manager's Office page"
              className="grid size-9 place-items-center rounded-sm border border-border-primary bg-surface/75 text-text-secondary hover:border-text-muted hover:text-text-primary disabled:cursor-default disabled:opacity-30"
              disabled={refreshing || page >= totalPages}
              onClick={() =>
                setQueueQuery((current) => ({
                  ...current,
                  page: page + 1,
                }))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
