import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";
import { claimTmdbRefresh, executeTmdbRefreshClaim } from "./tmdb-refresh";
import { TMDB_REFRESH_ATTRIBUTION } from "./attribution";

const startedAt = "2026-08-24T01:30:00.123Z";
const failure = new Error("Synthetic refresh read failure");
const failingDatabase = () =>
  new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          if (sql.includes("FROM movie_tmdb_data")) throw failure;
          return target.prepare(sql);
        };
      }
      return Reflect.get(target, property, target);
    },
  });

describe("refresh cadence changes during an active claim", () => {
  it.each([
    { failed: false, previous: 7200, current: 15 },
    { failed: false, previous: 15, current: 7200 },
    { failed: true, previous: 7200, current: 15 },
    { failed: true, previous: 15, current: 7200 },
  ])(
    "uses interval $current after $previous with worker failure=$failed",
    async ({ failed, previous, current }) => {
      await env.DB.prepare(
        "UPDATE tmdb_refresh_schedule SET interval_minutes = ? WHERE id = 1",
      )
        .bind(previous)
        .run();
      const claim = await claimTmdbRefresh(env, true, startedAt);
      expect(claim).not.toBeNull();
      const response = await createApp().fetch(
        new Request("https://ludovico-tech.test/api/tmdb-refresh/schedule", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intervalMinutes: current,
            enabled: false,
            batchSize: 50,
          }),
        }),
        env,
      );
      expect(response.status).toBe(200);
      const execution = executeTmdbRefreshClaim(
        failed ? { ...env, DB: failingDatabase() } : env,
        claim!,
      );
      if (failed) await expect(execution).rejects.toThrow(failure);
      else await expect(execution).resolves.toMatchObject({ started: true });
      const stored = await env.DB.prepare(
        `SELECT interval_minutes, batch_size, enabled, next_run_at,
                lease_expires_at, last_completed_at, last_error, updated_by
         FROM tmdb_refresh_schedule WHERE id = 1`,
      ).first();
      expect(stored).toMatchObject({
        interval_minutes: current,
        batch_size: 50,
        enabled: 0,
        next_run_at: new Date(
          Date.parse(startedAt) + current * 60_000,
        ).toISOString(),
        lease_expires_at: null,
        last_completed_at: expect.any(String),
        last_error: failed ? "Refresh worker failed" : null,
        updated_by: TMDB_REFRESH_ATTRIBUTION,
      });
    },
  );

  it.each([false, true])(
    "does not overwrite a replacement lease, failure=%s",
    async (failed) => {
      const claim = await claimTmdbRefresh(env, true, startedAt);
      expect(claim).not.toBeNull();
      const replacementLease = "2099-01-01T00:00:00.000Z";
      await env.DB.prepare(
        `UPDATE tmdb_refresh_schedule SET interval_minutes = 15,
         next_run_at = ?, lease_expires_at = ? WHERE id = 1`,
      )
        .bind(replacementLease, replacementLease)
        .run();
      const execution = executeTmdbRefreshClaim(
        failed ? { ...env, DB: failingDatabase() } : env,
        claim!,
      );
      if (failed) await expect(execution).rejects.toThrow(failure);
      else await execution;
      expect(
        await env.DB.prepare(
          "SELECT next_run_at, lease_expires_at, last_completed_at FROM tmdb_refresh_schedule WHERE id = 1",
        ).first(),
      ).toEqual({
        next_run_at: replacementLease,
        lease_expires_at: replacementLease,
        last_completed_at: null,
      });
    },
  );
});
