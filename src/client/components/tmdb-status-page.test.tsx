import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type TmdbRefreshItem,
  type TmdbRefreshQueueQuery,
  type TmdbRefreshQueueResponse,
  type TmdbRefreshSummary,
} from "../api";
import { TmdbStatusPage } from "./tmdb-status-page";

const currentContractId = `sha256:${"a".repeat(64)}`;

const items: TmdbRefreshItem[] = [
  {
    contractId: null,
    fetchedAt: null,
    lastAttemptAt: null,
    lastError: null,
    lastResult: null,
    movieId: "pending-movie",
    refreshAfter: "1970-01-01T00:00:00.000Z",
    state: "never_fetched",
    title: "Pending Movie",
    tmdbId: 42,
  },
  {
    contractId: currentContractId,
    fetchedAt: "2026-08-23T18:45:00.000Z",
    lastAttemptAt: "2026-08-23T18:45:00.000Z",
    lastError: null,
    lastResult: "succeeded",
    movieId: "current-movie",
    refreshAfter: "2027-01-20T18:45:00.000Z",
    state: "current",
    title: "Current Movie",
    tmdbId: 7,
  },
  {
    contractId: null,
    fetchedAt: null,
    lastAttemptAt: null,
    lastError: null,
    lastResult: null,
    movieId: "unlinked-movie",
    refreshAfter: null,
    state: "unlinked",
    title: "Unlinked Movie",
    tmdbId: null,
  },
];

const summary: TmdbRefreshSummary = {
  counts: {
    current: 1,
    failed: 0,
    linked: 2,
    pending: 1,
    total: 3,
    unlinked: 1,
  },
  currentContractId,
  schedule: {
    batchSize: 25,
    enabled: true,
    intervalMinutes: 330,
    lastAttempted: 1,
    lastCompletedAt: "2026-08-24T01:00:00.000Z",
    lastError: null,
    lastFailed: 0,
    lastRateLimited: false,
    lastProcessingRetried: false,
    lastProcessingRowsRead: 1_234,
    lastProcessingRowsWritten: 56,
    lastRefreshed: 1,
    lastRemaining: 1,
    lastStartedAt: "2026-08-24T00:59:00.000Z",
    leaseExpiresAt: null,
    nextRunAt: "2026-08-24T07:00:00.000Z",
    running: false,
  },
};

const queue = (
  pageItems: TmdbRefreshItem[] = items,
  pagination: TmdbRefreshQueueResponse["pagination"] = {
    page: 1,
    pageSize: 50,
    total: 3,
    totalPages: 1,
  },
): TmdbRefreshQueueResponse => ({ items: pageItems, pagination });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TMDB refresh status page", () => {
  it("refreshes the overview on demand and after focus data becomes stale", async () => {
    let timestamp = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => timestamp);
    const loadOverview = vi
      .spyOn(api, "tmdbRefreshOverview")
      .mockResolvedValue({ queue: queue(), summary });
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockResolvedValue(queue());
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(loadOverview).toHaveBeenCalledTimes(1);
      expect(loadQueue).not.toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => {
      expect(loadOverview).toHaveBeenCalledTimes(2);
      expect(loadQueue).not.toHaveBeenCalled();
    });

    fireEvent.focus(window);
    expect(loadOverview).toHaveBeenCalledTimes(2);
    expect(loadQueue).not.toHaveBeenCalled();

    timestamp += 60_000;
    fireEvent.focus(window);
    await waitFor(() => {
      expect(loadOverview).toHaveBeenCalledTimes(3);
      expect(loadQueue).not.toHaveBeenCalled();
    });
  });

  it("searches and sorts the complete queue through bounded requests", async () => {
    vi.spyOn(api, "tmdbRefreshOverview").mockResolvedValue({
      queue: queue(),
      summary,
    });
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockImplementation(async (query: TmdbRefreshQueueQuery) => {
        if (query.search === "aaaaaaaa" || query.dateSearch) {
          return queue([items[1]], {
            page: 1,
            pageSize: query.pageSize,
            total: 1,
            totalPages: 1,
          });
        }
        return queue(items, {
          page: query.page,
          pageSize: query.pageSize,
          total: 51,
          totalPages: Math.ceil(51 / query.pageSize),
        });
      });
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    expect(await screen.findByText("Pending Movie")).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: /Status/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("Current fetch contract:")).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: "Fetch contract" }),
    ).toBeVisible();
    const search = screen.getByPlaceholderText("Search all fields…");
    fireEvent.change(search, { target: { value: "aaaaaaaa" } });
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: "aaaaaaaa" }),
      ),
    );
    expect(await screen.findByText("Current Movie")).toBeVisible();
    expect(screen.queryByText("Pending Movie")).toBeNull();

    const displayedDate = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-08-23T18:45:00.000Z"));
    fireEvent.change(search, { target: { value: displayedDate } });
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dateSearch: "2026-08-23T18:45:00.000Z",
          search: displayedDate,
        }),
      ),
    );

    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ direction: "asc", sort: "title" }),
      ),
    );
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    fireEvent.change(screen.getByLabelText("Filter refresh status"), {
      target: { value: "current" },
    });
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, state: "current" }),
      ),
    );
  });

  it("queues a current title and refreshes only the bounded queue", async () => {
    const dueItem: TmdbRefreshItem = {
      ...items[1],
      refreshAfter: "2026-08-24T01:30:00.000Z",
      state: "due",
    };
    const loadOverview = vi
      .spyOn(api, "tmdbRefreshOverview")
      .mockResolvedValue({ queue: queue(), summary });
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockResolvedValue(queue([items[0], dueItem, items[2]]));
    const queueRefetch = vi.spyOn(api, "queueTmdbRefetch").mockResolvedValue({
      alreadyQueued: false,
      queued: true,
      refreshAfter: dueItem.refreshAfter!,
    });
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    const currentRow = (await screen.findByText("Current Movie")).closest("tr");
    expect(currentRow).not.toBeNull();
    fireEvent.click(
      within(currentRow!).getByRole("button", {
        name: "Queue Current Movie for refetch",
      }),
    );

    await waitFor(() => {
      expect(queueRefetch).toHaveBeenCalledWith("current-movie");
      expect(loadQueue).toHaveBeenCalledTimes(1);
    });
    expect(loadOverview).toHaveBeenCalledTimes(1);
    const refreshedRow = screen.getByText("Current Movie").closest("tr");
    expect(within(refreshedRow!).getByText("Queued")).toBeVisible();
    expect(
      within(
        screen.getByText("Pending", { selector: "p" }).parentElement!,
      ).getByText("2"),
    ).toBeVisible();
    expect(
      within(
        screen.getByText("Current", { selector: "p" }).parentElement!,
      ).getByText("0"),
    ).toBeVisible();
    const unlinkedRow = screen.getByText("Unlinked Movie").closest("tr");
    expect(
      within(unlinkedRow!).queryByRole("button", { name: /refetch/i }),
    ).toBeNull();
  });

  it("keeps a current title actionable when queueing fails", async () => {
    vi.spyOn(api, "tmdbRefreshOverview").mockResolvedValue({
      queue: queue(),
      summary,
    });
    vi.spyOn(api, "tmdbRefreshQueue").mockResolvedValue(queue());
    vi.spyOn(api, "queueTmdbRefetch").mockRejectedValue(
      new Error("Unable to queue title"),
    );
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Queue Current Movie for refetch",
      }),
    );

    expect(await screen.findByText("Unable to queue title")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Queue Current Movie for refetch",
      }),
    ).toBeEnabled();
  });

  it("shows schedule controls and selects a page without reloading the summary", async () => {
    const loadOverview = vi
      .spyOn(api, "tmdbRefreshOverview")
      .mockResolvedValue({
        queue: queue(items, {
          page: 1,
          pageSize: 50,
          total: 151,
          totalPages: 4,
        }),
        summary,
      });
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockImplementation(async (query) =>
        queue(query.page === 3 ? [items[1]] : items, {
          page: query.page,
          pageSize: query.pageSize,
          total: 151,
          totalPages: Math.ceil(151 / query.pageSize),
        }),
      );
    const run = vi
      .spyOn(api, "runTmdbRefresh")
      .mockResolvedValue({ started: true });
    const updateSchedule = vi
      .spyOn(api, "updateTmdbRefreshSchedule")
      .mockResolvedValue({ updated: true });
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    expect(await screen.findByText(/every 5 hours 30 minutes/i)).toBeVisible();
    expect(screen.getByText("1,234 read, 56 written")).toBeVisible();
    expect(
      screen.getByText(/excludes scheduler, expiration maintenance/),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Manager's Office page"), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(loadQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 3 }),
      ),
    );
    expect(screen.getByLabelText("Manager's Office page")).toHaveValue("3");
    expect(loadOverview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: "Pause automatic updates" }),
    );
    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith({ enabled: false }),
    );

    fireEvent.change(screen.getByLabelText("Frequency (minutes)"), {
      target: { value: "720" },
    });
    fireEvent.change(screen.getByLabelText("Batch size"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith({
        batchSize: 50,
        intervalMinutes: 720,
      }),
    );
  });

  it("refreshes a manual run until completion and then reloads the queue", async () => {
    vi.useFakeTimers();
    const runningSchedule = {
      ...summary.schedule,
      lastStartedAt: "2026-08-24T02:00:00.000Z",
      leaseExpiresAt: "2026-08-24T02:20:00.000Z",
      running: true,
    };
    const completedSummary: TmdbRefreshSummary = {
      ...summary,
      counts: { ...summary.counts, current: 2, pending: 0 },
      schedule: {
        ...summary.schedule,
        lastCompletedAt: "2026-08-24T02:00:10.000Z",
        lastRefreshed: 2,
        lastRemaining: 0,
      },
    };
    const loadOverview = vi
      .spyOn(api, "tmdbRefreshOverview")
      .mockResolvedValueOnce({ queue: queue(), summary })
      .mockResolvedValueOnce({ queue: queue(), summary: completedSummary });
    const loadRunStatus = vi
      .spyOn(api, "tmdbRefreshRunStatus")
      .mockResolvedValueOnce({ schedule: runningSchedule })
      .mockResolvedValueOnce({ schedule: completedSummary.schedule });
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockResolvedValue(queue());
    const run = vi
      .spyOn(api, "runTmdbRefresh")
      .mockResolvedValue({ started: true });

    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadOverview).toHaveBeenCalledTimes(1);
    expect(loadQueue).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run now" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(loadOverview).toHaveBeenCalledTimes(1);
    expect(loadRunStatus).not.toHaveBeenCalled();
    expect(loadQueue).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Refresh running" }),
    ).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(1);
    expect(loadOverview).toHaveBeenCalledTimes(1);
    expect(loadQueue).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(2);
    expect(loadOverview).toHaveBeenCalledTimes(2);
    expect(loadQueue).not.toHaveBeenCalled();
    expect(screen.getByText("2 refreshed, 0 failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(2);
    expect(loadOverview).toHaveBeenCalledTimes(2);
    expect(loadQueue).not.toHaveBeenCalled();
  });

  it("allows a manual run while automatic updates are paused", async () => {
    const pausedSummary: TmdbRefreshSummary = {
      ...summary,
      schedule: { ...summary.schedule, enabled: false },
    };
    vi.spyOn(api, "tmdbRefreshOverview").mockResolvedValue({
      queue: queue(),
      summary: pausedSummary,
    });
    const run = vi
      .spyOn(api, "runTmdbRefresh")
      .mockResolvedValue({ started: true });

    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    const runNow = await screen.findByRole("button", { name: "Run now" });
    expect(runNow).toBeEnabled();
    expect(
      screen.getByText("Paused. No scheduled batches will start."),
    ).toBeVisible();
    fireEvent.click(runNow);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("does not request operational data for an anonymous visitor", () => {
    const loadOverview = vi.spyOn(api, "tmdbRefreshOverview");
    const loadRunStatus = vi.spyOn(api, "tmdbRefreshRunStatus");
    const loadQueue = vi.spyOn(api, "tmdbRefreshQueue");
    render(<TmdbStatusPage canMutate={false} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Manager's Office" }),
    ).toBeVisible();
    expect(screen.getByText(/Sign in to view/)).toBeVisible();
    expect(loadOverview).not.toHaveBeenCalled();
    expect(loadRunStatus).not.toHaveBeenCalled();
    expect(loadQueue).not.toHaveBeenCalled();
  });
});
