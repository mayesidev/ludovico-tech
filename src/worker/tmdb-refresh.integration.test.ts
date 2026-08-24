import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./env";
import { createApp } from "./index";
import {
  claimTmdbRefresh,
  executeTmdbRefreshClaim,
  getTmdbRefreshStatus,
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
     (id, title, title_normalized, added_at, updated_at, tmdb_id,
      tmdb_fetched_at)
     VALUES ('scheduled-status', 'Library Title', 'library title', ?, ?, 42, ?)`,
  )
    .bind(timestamp, timestamp, "2026-01-01T00:00:00.000Z")
    .run();
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

afterEach(() => vi.unstubAllGlobals());

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
    await expect(
      runTmdbRefresh(bindings(), { force: true, timestamp }),
    ).resolves.toEqual({ report: null, remaining: null, started: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("atomically prevents overlapping scheduled and manual claims", async () => {
    const [first, second] = await Promise.all([
      claimTmdbRefresh(bindings(), true, timestamp),
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
      intervalMinutes: 15,
      lastAttempted: 1,
      lastFailed: 0,
      lastRefreshed: 1,
      lastRemaining: 0,
      nextRunAt: "2026-08-24T01:45:00.000Z",
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
    await insertLinkedMovie();
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
      schedule: { lastRefreshed: number; running: boolean };
    };
    expect(statusResponse.status).toBe(200);
    expect(status).toMatchObject({
      counts: { current: 1, pending: 0 },
      schedule: { lastRefreshed: 1, running: false },
    });
    expect(
      await env.DB.prepare(
        "SELECT action FROM audit_log WHERE entity_type = 'tmdb_refresh_schedule'",
      ).first(),
    ).toEqual({ action: "run_requested" });
  });

  it("pauses and resumes automatic refresh through an audited control", async () => {
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
    expect(await pause.json()).toEqual({ enabled: false });
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
    expect(await resume.json()).toEqual({ enabled: true });
    const actions = (
      await env.DB.prepare(
        `SELECT action FROM audit_log
         WHERE entity_type = 'tmdb_refresh_schedule'`,
      ).all<{ action: string }>()
    ).results.map(({ action }) => action);
    expect(actions).toHaveLength(2);
    expect(actions).toEqual(
      expect.arrayContaining(["schedule_paused", "schedule_resumed"]),
    );
  });
});
