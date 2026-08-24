import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./env";
import { createApp } from "./index";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";
import { refreshDueTmdbData } from "./tmdb-data";
import {
  claimTmdbRefresh,
  executeTmdbRefreshClaim,
  getTmdbRefreshQueue,
  getTmdbRefreshStatus,
  getTmdbRefreshSummary,
  runTmdbRefresh,
} from "./tmdb-refresh";

const timestamp = "2026-08-24T01:30:00.000Z";

const bindings = () =>
  ({
    ...env,
    APP_ENV: "development",
    AUTH_MODE: "development",
    TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
  }) as AppEnv["Bindings"];

const insertLinkedMovie = async () => {
  await env.DB.prepare(
    `INSERT INTO movies
     (id, title, title_normalized, added_at, updated_at)
     VALUES ('scheduled-status', 'Library Title', 'library title', ?, ?)`,
  )
    .bind(timestamp, timestamp)
    .run();
  await env.DB.prepare(
    `INSERT INTO movie_tmdb_data
     (movie_id, tmdb_id, refresh_after)
     VALUES ('scheduled-status', 42, '1970-01-01T00:00:00.000Z')`,
  ).run();
};

const insertUnlinkedMovie = async () => {
  await env.DB.prepare(
    `INSERT INTO movies
     (id, title, title_normalized, added_at, updated_at)
     VALUES ('unlinked-status', 'Unlinked Title', 'unlinked title', ?, ?)`,
  )
    .bind(timestamp, timestamp)
    .run();
};

const tmdbResponse = () =>
  new Response(
    JSON.stringify({
      belongs_to_collection: null,
      credits: {
        cast: [{ id: 101, name: "Status Actor", order: 0 }],
        crew: [{ id: 201, job: "Director", name: "Status Director" }],
      },
      id: 42,
      poster_path: "/status.jpg",
      release_date: "2025-01-02",
      runtime: 125,
      title: "Provider Title",
    }),
    { status: 200 },
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TMDB refresh operations", () => {
  it("does no provider work when the internal schedule is not due", async () => {
    await env.DB.prepare(
      "UPDATE tmdb_refresh_schedule SET next_run_at = ? WHERE id = 1",
    )
      .bind("2026-08-24T02:00:00.000Z")
      .run();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runTmdbRefresh(bindings(), { timestamp })).resolves.toEqual({
      report: null,
      remaining: null,
      started: false,
    });
    await env.DB.prepare(
      `UPDATE tmdb_refresh_schedule
       SET enabled = 0, next_run_at = '1970-01-01T00:00:00.000Z'
       WHERE id = 1`,
    ).run();
    await expect(runTmdbRefresh(bindings(), { timestamp })).resolves.toEqual({
      report: null,
      remaining: null,
      started: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("atomically prevents overlapping scheduled and manual claims", async () => {
    const [first, second] = await Promise.all([
      claimTmdbRefresh(bindings(), false, timestamp),
      claimTmdbRefresh(bindings(), true, timestamp),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("persists run and per-title status after a bounded refresh", async () => {
    await insertLinkedMovie();
    await insertUnlinkedMovie();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tmdbResponse()));
    const claim = await claimTmdbRefresh(bindings(), true, timestamp);
    expect(claim).not.toBeNull();

    await expect(
      executeTmdbRefreshClaim(bindings(), claim!),
    ).resolves.toMatchObject({
      remaining: 0,
      report: { attempted: 1, failed: 0, refreshed: 1 },
      started: true,
    });

    const status = await getTmdbRefreshStatus(bindings(), timestamp);
    expect(status.counts).toEqual({
      current: 1,
      failed: 0,
      linked: 1,
      pending: 0,
      total: 2,
      unlinked: 1,
    });
    expect(status.schedule).toMatchObject({
      intervalMinutes: 360,
      lastAttempted: 1,
      lastFailed: 0,
      lastRefreshed: 1,
      lastRemaining: 0,
      nextRunAt: "2026-08-24T07:30:00.000Z",
      running: false,
    });
    expect(status.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lastAttemptAt: timestamp,
          lastResult: "succeeded",
          movieId: "scheduled-status",
          state: "current",
          title: "Library Title",
          tmdbId: 42,
        }),
        expect.objectContaining({
          movieId: "unlinked-status",
          state: "unlinked",
          title: "Unlinked Title",
          tmdbId: null,
        }),
      ]),
    );
  });

  it("refreshes a mismatched contract even before its time window is due", async () => {
    await env.DB.prepare(
      `INSERT INTO movies
       (id, title, title_normalized, added_at, updated_at)
       VALUES ('stale-contract', 'Stale Contract', 'stale contract', ?, ?)`,
    )
      .bind(timestamp, timestamp)
      .run();
    await env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, fetched_at, refresh_after, expires_at, contract_id)
       VALUES ('stale-contract', 42, ?, '2027-01-20T00:00:00.000Z',
               '2027-02-20T00:00:00.000Z', ?)`,
    )
      .bind(timestamp, `sha256:${"b".repeat(64)}`)
      .run();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tmdbResponse()));

    const before = await getTmdbRefreshQueue(
      bindings(),
      {
        dateSearch: "",
        direction: "asc",
        page: 1,
        pageSize: 25,
        search: "",
        sort: "state",
        state: "all",
      },
      timestamp,
    );
    expect(before.items[0]).toMatchObject({
      movieId: "stale-contract",
      state: "contract_stale",
    });
    await expect(
      refreshDueTmdbData(bindings(), timestamp),
    ).resolves.toMatchObject({ attempted: 1, failed: 0, refreshed: 1 });
    expect(
      await env.DB.prepare(
        "SELECT contract_id FROM movie_tmdb_data WHERE movie_id = 'stale-contract'",
      ).first(),
    ).toEqual({ contract_id: await getTmdbMetadataContractId() });
  });

  it("separates global refresh summary from the paginated title queue", async () => {
    const movies = Array.from({ length: 30 }, (_, index) => ({
      id: `queue-movie-${String(index).padStart(2, "0")}`,
      title: `Queue Movie ${String(index).padStart(2, "0")}`,
    }));
    await env.DB.batch(
      movies.map((movie) =>
        env.DB.prepare(
          `INSERT INTO movies
           (id, title, title_normalized, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          movie.id,
          movie.title,
          movie.title.toLowerCase(),
          timestamp,
          timestamp,
        ),
      ),
    );
    await env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, fetched_at, refresh_after, expires_at, contract_id)
       VALUES (?, 90210, ?, '2027-01-20T18:45:00.000Z', '2027-02-20T18:45:00.000Z', ?)`,
    )
      .bind(
        movies[29].id,
        "2026-08-23T18:45:00.000Z",
        await getTmdbMetadataContractId(),
      )
      .run();

    const summary = await getTmdbRefreshSummary(bindings(), timestamp);
    expect(summary.counts).toEqual({
      current: 1,
      failed: 0,
      linked: 1,
      pending: 0,
      total: 30,
      unlinked: 29,
    });
    const firstPage = await getTmdbRefreshQueue(
      bindings(),
      {
        dateSearch: "",
        direction: "asc",
        page: 1,
        pageSize: 25,
        search: "",
        sort: "title",
        state: "all",
      },
      timestamp,
    );
    expect(firstPage.pagination).toEqual({
      page: 1,
      pageSize: 25,
      total: 30,
      totalPages: 2,
    });
    expect(firstPage.items).toHaveLength(25);

    const dateResult = await getTmdbRefreshQueue(
      bindings(),
      {
        dateSearch: "2026-08-23T18:45:00.000Z",
        direction: "asc",
        page: 2,
        pageSize: 25,
        search: "Aug 23, 2026, 1:45 PM",
        sort: "fetchedAt",
        state: "all",
      },
      timestamp,
    );
    expect(dateResult.pagination).toMatchObject({ page: 1, total: 1 });
    expect(dateResult.items[0]).toMatchObject({
      contractId: await getTmdbMetadataContractId(),
      movieId: movies[29].id,
      state: "current",
      tmdbId: 90210,
    });

    const contractResult = await getTmdbRefreshQueue(
      bindings(),
      {
        dateSearch: "",
        direction: "asc",
        page: 1,
        pageSize: 25,
        search: (await getTmdbMetadataContractId()).slice(7, 15),
        sort: "contractId",
        state: "all",
      },
      timestamp,
    );
    expect(contractResult.pagination.total).toBe(1);
    expect(contractResult.items[0].movieId).toBe(movies[29].id);

    const queueResponse = await createApp().fetch(
      new Request(
        "https://ludovico-tech.test/api/tmdb-refresh/items?page=2&pageSize=25&sort=title",
      ),
      bindings(),
    );
    expect(queueResponse.status).toBe(200);
    expect(await queueResponse.json()).toMatchObject({
      pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2 },
    });

    const invalidResponse = await createApp().fetch(
      new Request(
        "https://ludovico-tech.test/api/tmdb-refresh/items?pageSize=10",
      ),
      bindings(),
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("keeps rate-limited work visible and eligible for retry", async () => {
    await insertLinkedMovie();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );

    await expect(
      runTmdbRefresh(bindings(), { force: true, timestamp }),
    ).resolves.toMatchObject({
      remaining: 1,
      report: { attempted: 1, failed: 1, rateLimited: true, refreshed: 0 },
    });
    const status = await getTmdbRefreshStatus(bindings(), timestamp);
    expect(status.schedule).toMatchObject({
      lastFailed: 1,
      lastRateLimited: true,
      lastRemaining: 1,
    });
    expect(status.items[0]).toMatchObject({
      lastError: "TMDB rate limited the refresh",
      lastResult: "failed",
      state: "failed",
    });
  });

  it("runs immediately through the authenticated application endpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    await insertLinkedMovie();
    await env.DB.prepare(
      `UPDATE tmdb_refresh_schedule
       SET enabled = 0, next_run_at = '2026-08-25T00:00:00.000Z'
       WHERE id = 1`,
    ).run();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tmdbResponse()));
    const executionContext = createExecutionContext();
    const response = await createApp().fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh/run", {
        method: "POST",
      }),
      bindings(),
      executionContext,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ started: true });
    await waitOnExecutionContext(executionContext);

    const statusResponse = await createApp().fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh"),
      bindings(),
    );
    const status = (await statusResponse.json()) as {
      counts: { current: number; pending: number };
      schedule: {
        enabled: boolean;
        lastRefreshed: number;
        nextRunAt: string;
        running: boolean;
      };
    };
    expect(statusResponse.status).toBe(200);
    expect(status).toMatchObject({
      counts: { current: 1, pending: 0 },
      schedule: {
        enabled: false,
        lastRefreshed: 1,
        nextRunAt: "2026-08-24T07:30:00.000Z",
        running: false,
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT action FROM audit_log WHERE entity_type = 'tmdb_refresh_schedule'",
      ).first(),
    ).toEqual({ action: "run_requested" });
  });

  it("updates the automatic refresh schedule through audited controls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    const app = createApp();
    const pause = await app.fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh/schedule", {
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      bindings(),
    );

    expect(pause.status).toBe(200);
    expect(await pause.json()).toEqual({ updated: true });
    expect(
      await env.DB.prepare(
        "SELECT enabled FROM tmdb_refresh_schedule WHERE id = 1",
      ).first(),
    ).toEqual({ enabled: 0 });

    const resume = await app.fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh/schedule", {
        body: JSON.stringify({ enabled: true }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      bindings(),
    );
    expect(resume.status).toBe(200);
    expect(await resume.json()).toEqual({ updated: true });

    const invalid = await app.fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh/schedule", {
        body: JSON.stringify({ intervalMinutes: 16 }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      bindings(),
    );
    expect(invalid.status).toBe(400);

    const update = await app.fetch(
      new Request("https://ludovico-tech.test/api/tmdb-refresh/schedule", {
        body: JSON.stringify({ batchSize: 50, intervalMinutes: 720 }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      bindings(),
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ updated: true });
    expect(
      await env.DB.prepare(
        `SELECT batch_size, enabled, interval_minutes, next_run_at
         FROM tmdb_refresh_schedule WHERE id = 1`,
      ).first(),
    ).toEqual({
      batch_size: 50,
      enabled: 1,
      interval_minutes: 720,
      next_run_at: "2026-08-24T13:30:00.000Z",
    });
    const actions = (
      await env.DB.prepare(
        `SELECT action FROM audit_log
         WHERE entity_type = 'tmdb_refresh_schedule'`,
      ).all<{ action: string }>()
    ).results.map(({ action }) => action);
    expect(actions).toHaveLength(3);
    expect(actions).toEqual(
      expect.arrayContaining([
        "schedule_paused",
        "schedule_resumed",
        "schedule_updated",
      ]),
    );
  });
});
