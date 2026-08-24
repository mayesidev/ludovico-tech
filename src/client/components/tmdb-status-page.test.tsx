import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
  it("refreshes the summary and current queue page on demand and focus", async () => {
    const loadSummary = vi
      .spyOn(api, "tmdbRefreshSummary")
      .mockResolvedValue(summary);
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockResolvedValue(queue());
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(1);
      expect(loadQueue).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(2);
      expect(loadQueue).toHaveBeenCalledTimes(2);
    });

    fireEvent.focus(window);
    await waitFor(() => {
      expect(loadSummary).toHaveBeenCalledTimes(3);
      expect(loadQueue).toHaveBeenCalledTimes(3);
    });
  });

  it("searches and sorts the complete queue through bounded requests", async () => {
    vi.spyOn(api, "tmdbRefreshSummary").mockResolvedValue(summary);
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

  it("shows schedule controls and paginates without reloading the summary", async () => {
    const loadSummary = vi
      .spyOn(api, "tmdbRefreshSummary")
      .mockResolvedValue(summary);
    const loadQueue = vi
      .spyOn(api, "tmdbRefreshQueue")
      .mockImplementation(async (query) =>
        queue(query.page === 2 ? [items[1]] : items, {
          page: query.page,
          pageSize: query.pageSize,
          total: 51,
          totalPages: Math.ceil(51 / query.pageSize),
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
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Next Manager's Office page" }),
    );
    expect(await screen.findByText("Page 2 of 2")).toBeVisible();
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );

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
    const loadSummary = vi
      .spyOn(api, "tmdbRefreshSummary")
      .mockResolvedValueOnce(summary)
      .mockResolvedValueOnce(completedSummary);
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
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadQueue).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run now" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadRunStatus).not.toHaveBeenCalled();
    expect(loadQueue).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Refresh running" }),
    ).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(1);
    expect(loadSummary).toHaveBeenCalledTimes(1);
    expect(loadQueue).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(2);
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect(loadQueue).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2 refreshed, 0 failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeEnabled();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(loadRunStatus).toHaveBeenCalledTimes(2);
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect(loadQueue).toHaveBeenCalledTimes(2);
  });

  it("allows a manual run while automatic updates are paused", async () => {
    const pausedSummary: TmdbRefreshSummary = {
      ...summary,
      schedule: { ...summary.schedule, enabled: false },
    };
    vi.spyOn(api, "tmdbRefreshSummary").mockResolvedValue(pausedSummary);
    vi.spyOn(api, "tmdbRefreshQueue").mockResolvedValue(queue());
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
    const loadSummary = vi.spyOn(api, "tmdbRefreshSummary");
    const loadRunStatus = vi.spyOn(api, "tmdbRefreshRunStatus");
    const loadQueue = vi.spyOn(api, "tmdbRefreshQueue");
    render(<TmdbStatusPage canMutate={false} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Manager's Office" }),
    ).toBeVisible();
    expect(screen.getByText(/Sign in to view/)).toBeVisible();
    expect(loadSummary).not.toHaveBeenCalled();
    expect(loadRunStatus).not.toHaveBeenCalled();
    expect(loadQueue).not.toHaveBeenCalled();
  });
});
