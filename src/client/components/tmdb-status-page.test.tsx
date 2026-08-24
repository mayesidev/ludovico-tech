import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type TmdbRefreshStatus } from "../api";
import { TmdbStatusPage } from "./tmdb-status-page";

const status: TmdbRefreshStatus = {
  counts: {
    current: 1,
    failed: 0,
    linked: 2,
    pending: 1,
    total: 3,
    unlinked: 1,
  },
  currentDataVersion: 1,
  items: [
    {
      dataVersion: 0,
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
      dataVersion: 1,
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
      dataVersion: null,
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
  ],
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

afterEach(() => vi.restoreAllMocks());

describe("TMDB refresh status page", () => {
  it("shows the schedule, queue, and immediate refresh action", async () => {
    vi.spyOn(api, "tmdbRefreshStatus").mockResolvedValue(status);
    const run = vi
      .spyOn(api, "runTmdbRefresh")
      .mockResolvedValue({ started: true });
    const updateSchedule = vi
      .spyOn(api, "updateTmdbRefreshSchedule")
      .mockResolvedValue({ updated: true });
    render(<TmdbStatusPage canMutate onNavigate={vi.fn()} />);

    expect(await screen.findByText("Pending Movie")).toBeVisible();
    expect(screen.getByText("Linked")).toBeVisible();
    expect(screen.getByText("Not linked (excluded)")).toBeVisible();
    expect(screen.queryByText("Eligible")).toBeNull();
    expect(
      screen.queryByText(/titles are linked for automatic updates/i),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Pending Movie" })).toHaveAttribute(
      "href",
      "/movies/pending-movie?from=manager-office",
    );
    expect(screen.getByText(/every 5 hours 30 minutes/i)).toBeVisible();
    expect(
      screen.getByRole("columnheader", {
        name: "Data version (current: 1)",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Pending work appears first/i)).toBeNull();
    expect(screen.getByText("Never fetched")).toBeVisible();
    expect(screen.getByText("Unlinked Movie")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "TMDB ID" })).toBeVisible();
    expect(screen.getByPlaceholderText("Search all fields…")).toBeVisible();

    const search = screen.getByPlaceholderText("Search all fields…");
    fireEvent.change(search, { target: { value: "1/1" } });
    expect(screen.getByText("Current Movie")).toBeVisible();
    expect(screen.queryByText("Pending Movie")).toBeNull();
    const displayedDate = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-08-23T18:45:00.000Z"));
    fireEvent.change(search, { target: { value: displayedDate } });
    expect(screen.getByText("Current Movie")).toBeVisible();
    expect(screen.queryByText("Pending Movie")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Unlinked Movie");

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

  it("does not request operational data for an anonymous visitor", () => {
    const load = vi.spyOn(api, "tmdbRefreshStatus");
    render(<TmdbStatusPage canMutate={false} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Manager's Office" }),
    ).toBeVisible();
    expect(screen.getByText(/Sign in to view/)).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });
});
