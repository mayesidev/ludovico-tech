import { useCallback, useEffect, useMemo, useState } from "react";
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { RefreshCw, Search } from "lucide-react";
import { api, type TmdbRefreshStatus } from "../api";
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
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
};

type StatusItem = TmdbRefreshStatus["items"][number];

const stateLabel: Record<StatusItem["state"], string> = {
  current: "Current",
  due: "Due",
  failed: "Failed",
  never_fetched: "Never fetched",
  unlinked: "Not linked",
  version_stale: "Version stale",
};

const statusTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
  },
});

type StatusColumnDef = ColumnDef<typeof statusTableFeatures, StatusItem>;

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
  const [updatingSchedule, setUpdatingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [intervalMinutesInput, setIntervalMinutesInput] = useState<
    string | null
  >(null);
  const [batchSizeInput, setBatchSizeInput] = useState<string | null>(null);

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

  const hasStatus = status !== null;
  const refreshRunning = status?.schedule.running ?? false;
  useEffect(() => {
    if (!hasStatus) return;
    const interval = window.setInterval(
      () => void load(),
      refreshRunning ? 1500 : 60_000,
    );
    return () => window.clearInterval(interval);
  }, [hasStatus, load, refreshRunning]);

  const columns = useMemo<StatusColumnDef[]>(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        sortFn: "alphanumeric",
        cell: ({ row }) => (
          <AppLink
            className="font-semibold text-text-primary hover:text-highlight-soft"
            href={`/movies/${encodeURIComponent(row.original.movieId)}?from=library`}
            onNavigate={onNavigate}
          >
            {row.original.title}
          </AppLink>
        ),
      },
      {
        accessorKey: "tmdbId",
        header: "TMDB ID",
        sortFn: "basic",
        sortUndefined: "last",
        cell: ({ getValue }) => (getValue() as number | null) ?? "—",
      },
      {
        id: "state",
        accessorFn: (item) => stateLabel[item.state],
        header: "Status",
        sortFn: "alphanumeric",
        cell: ({ row }) => (
          <span
            className={
              row.original.state === "failed"
                ? "text-danger"
                : row.original.state === "current"
                  ? "text-text-secondary"
                  : "text-highlight-soft"
            }
          >
            {stateLabel[row.original.state]}
            {row.original.lastError && (
              <span className="mt-1 block max-w-64 text-xs text-danger">
                {row.original.lastError}
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "fetchedAt",
        header: "Last fetched",
        sortFn: "alphanumeric",
        sortUndefined: "last",
        cell: ({ row }) =>
          formatTimestamp(
            row.original.fetchedAt,
            row.original.state === "unlinked" ? "—" : "Never",
          ),
      },
      {
        accessorKey: "lastAttemptAt",
        header: "Last attempt",
        sortFn: "alphanumeric",
        sortUndefined: "last",
        cell: ({ getValue }) =>
          formatTimestamp((getValue() as string | null) ?? null, "—"),
      },
      {
        accessorKey: "refreshAfter",
        header: "Refresh after",
        sortFn: "alphanumeric",
        sortUndefined: "last",
        cell: ({ getValue }) =>
          formatDueTimestamp((getValue() as string | null) ?? null),
      },
      {
        accessorKey: "dataVersion",
        header: "Data version",
        sortFn: "basic",
        sortUndefined: "last",
        cell: ({ row }) =>
          row.original.dataVersion === null
            ? "—"
            : `${row.original.dataVersion}/${status?.currentDataVersion ?? row.original.dataVersion}`,
      },
    ],
    [onNavigate, status?.currentDataVersion],
  );

  const table = useTable({
    features: statusTableFeatures,
    data: status?.items ?? [],
    columns,
    state: { globalFilter: filter, sorting },
    onGlobalFilterChange: setFilter,
    onSortingChange: setSorting,
    globalFilterFn: "includesString",
  });

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

  if (loading || !status) {
    return <p className="text-text-muted">Loading refresh data…</p>;
  }

  const { schedule, counts } = status;
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
  return (
    <div>
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-3xl font-medium leading-none tracking-[0.01em] text-text-primary sm:text-4xl">
            Manager's Office
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Automatic Library updates, TMDB links, and refresh history.{" "}
            {counts.linked} of {counts.total} titles are eligible.
          </p>
        </div>
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
        <p className="mb-6 rounded-sm border border-danger/50 bg-danger-surface px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Card className="mb-8 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-border-subtle sm:grid-cols-5 sm:divide-y-0">
          {[
            ["Eligible", counts.linked],
            ["Not linked", counts.unlinked],
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
                  : "Paused. No scheduled batches will start."}{" "}
                Data version {status.currentDataVersion}.
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

      <div className="mb-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-heading text-2xl font-medium tracking-tight text-text-primary">
            Library metadata
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            Pending work appears first until you choose another sort order.
          </p>
        </div>
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
            placeholder="Search titles or TMDB IDs…"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="ui-label border-b border-highlight/15 bg-[#7a1d30] text-text-primary/80">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : header.column.getCanSort()
                              ? "none"
                              : undefined
                      }
                      className="border-r border-highlight/10 px-5 py-4 font-semibold last:border-r-0"
                      key={header.id}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          className="text-text-primary hover:text-highlight-soft"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {header.column.getIsSorted()
                            ? header.column.getIsSorted() === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="data-surface divide-y divide-border-subtle">
              {table.getRowModel().rows.map((row) => (
                <tr
                  className="bg-canvas/35 transition hover:bg-action/15"
                  key={row.id}
                >
                  {row.getAllCells().map((cell) => (
                    <td className="px-5 py-4 text-text-muted" key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-action/45 bg-action/10 px-5 py-4 text-xs text-text-muted">
          {table.getFilteredRowModel().rows.length} of {counts.total} Library
          titles
        </div>
      </Card>
    </div>
  );
}
