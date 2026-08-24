import type { AppEnv } from "./env";
import {
  countDueTmdbData,
  refreshDueTmdbData,
  type TmdbRefreshReport,
} from "./tmdb-data";
import { CURRENT_TMDB_DATA_VERSION } from "./tmdb";

const SCHEDULE_ID = 1;
const LEASE_MS = 20 * 60 * 1000;
const STATUS_ITEM_LIMIT = 250;

const addMilliseconds = (timestamp: string, milliseconds: number) =>
  new Date(new Date(timestamp).getTime() + milliseconds).toISOString();

type TmdbRefreshClaim = {
  batchSize: number;
  intervalMinutes: number;
  leaseExpiresAt: string;
  startedAt: string;
};

type ScheduleRow = {
  batch_size: number;
  enabled: number;
  interval_minutes: number;
  last_attempted_count: number;
  last_completed_at: string | null;
  last_error: string | null;
  last_failed_count: number;
  last_rate_limited: number;
  last_refreshed_count: number;
  last_remaining_count: number;
  last_started_at: string | null;
  lease_expires_at: string | null;
  next_run_at: string;
};

export type TmdbRefreshRunResult = {
  report: TmdbRefreshReport | null;
  remaining: number | null;
  started: boolean;
};

export const claimTmdbRefresh = async (
  env: AppEnv["Bindings"],
  force = false,
  timestamp = new Date().toISOString(),
): Promise<TmdbRefreshClaim | null> => {
  const leaseExpiresAt = addMilliseconds(timestamp, LEASE_MS);
  const row = await env.DB.prepare(
    `UPDATE tmdb_refresh_schedule SET
       lease_expires_at = ?,
       last_started_at = ?,
       last_error = NULL,
       updated_at = ?
     WHERE id = ?
       AND enabled = 1
       AND (? = 1 OR next_run_at <= ?)
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
     RETURNING interval_minutes, batch_size`,
  )
    .bind(
      leaseExpiresAt,
      timestamp,
      timestamp,
      SCHEDULE_ID,
      force ? 1 : 0,
      timestamp,
      timestamp,
    )
    .first<{ batch_size: number; interval_minutes: number }>();
  return row
    ? {
        batchSize: row.batch_size,
        intervalMinutes: row.interval_minutes,
        leaseExpiresAt,
        startedAt: timestamp,
      }
    : null;
};

const finishClaim = async (
  env: AppEnv["Bindings"],
  claim: TmdbRefreshClaim,
  report: TmdbRefreshReport,
  remaining: number,
) => {
  const completedAt = new Date().toISOString();
  const nextRunAt = addMilliseconds(
    claim.startedAt,
    claim.intervalMinutes * 60 * 1000,
  );
  const lastError = report.rateLimited
    ? "TMDB rate limited the refresh"
    : report.failed > 0
      ? `${report.failed} title refresh${report.failed === 1 ? "" : "es"} failed`
      : null;
  await env.DB.prepare(
    `UPDATE tmdb_refresh_schedule SET
       next_run_at = ?,
       lease_expires_at = NULL,
       last_completed_at = ?,
       last_attempted_count = ?,
       last_refreshed_count = ?,
       last_failed_count = ?,
       last_remaining_count = ?,
       last_rate_limited = ?,
       last_error = ?,
       updated_at = ?
     WHERE id = ? AND lease_expires_at = ?`,
  )
    .bind(
      nextRunAt,
      completedAt,
      report.attempted,
      report.refreshed,
      report.failed,
      remaining,
      report.rateLimited ? 1 : 0,
      lastError,
      completedAt,
      SCHEDULE_ID,
      claim.leaseExpiresAt,
    )
    .run();
};

const failClaim = async (env: AppEnv["Bindings"], claim: TmdbRefreshClaim) => {
  const completedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE tmdb_refresh_schedule SET
       next_run_at = ?,
       lease_expires_at = NULL,
       last_completed_at = ?,
       last_error = 'Refresh worker failed',
       updated_at = ?
     WHERE id = ? AND lease_expires_at = ?`,
  )
    .bind(
      addMilliseconds(claim.startedAt, claim.intervalMinutes * 60 * 1000),
      completedAt,
      completedAt,
      SCHEDULE_ID,
      claim.leaseExpiresAt,
    )
    .run();
};

export const executeTmdbRefreshClaim = async (
  env: AppEnv["Bindings"],
  claim: TmdbRefreshClaim,
): Promise<TmdbRefreshRunResult> => {
  try {
    const report = await refreshDueTmdbData(
      env,
      claim.startedAt,
      claim.batchSize,
    );
    const remaining = await countDueTmdbData(env, new Date().toISOString());
    await finishClaim(env, claim, report, remaining);
    return { report, remaining, started: true };
  } catch (error) {
    await failClaim(env, claim);
    throw error;
  }
};

export const runTmdbRefresh = async (
  env: AppEnv["Bindings"],
  options: { force?: boolean; timestamp?: string } = {},
): Promise<TmdbRefreshRunResult> => {
  const claim = await claimTmdbRefresh(env, options.force, options.timestamp);
  if (!claim) return { report: null, remaining: null, started: false };
  return executeTmdbRefreshClaim(env, claim);
};

export const getTmdbRefreshStatus = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const [schedule, counts, items] = await Promise.all([
    env.DB.prepare("SELECT * FROM tmdb_refresh_schedule WHERE id = ?")
      .bind(SCHEDULE_ID)
      .first<ScheduleRow>(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS linked,
         SUM(CASE WHEN refresh_after <= ? OR data_version < ? THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN refresh_after > ? AND data_version >= ? THEN 1 ELSE 0 END) AS current,
         SUM(CASE WHEN last_refresh_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM movie_tmdb_data`,
    )
      .bind(
        timestamp,
        CURRENT_TMDB_DATA_VERSION,
        timestamp,
        CURRENT_TMDB_DATA_VERSION,
      )
      .first<{
        current: number | null;
        failed: number | null;
        linked: number;
        pending: number | null;
      }>(),
    env.DB.prepare(
      `SELECT
         movie_tmdb_data.movie_id,
         movies.title,
         movie_tmdb_data.tmdb_id,
         movie_tmdb_data.fetched_at,
         movie_tmdb_data.refresh_after,
         movie_tmdb_data.data_version,
         movie_tmdb_data.last_refresh_attempt_at,
         movie_tmdb_data.last_refresh_status,
         movie_tmdb_data.last_refresh_error,
         CASE
           WHEN movie_tmdb_data.last_refresh_status = 'failed' THEN 'failed'
           WHEN movie_tmdb_data.fetched_at IS NULL THEN 'never_fetched'
           WHEN movie_tmdb_data.data_version < ? THEN 'version_stale'
           WHEN movie_tmdb_data.refresh_after <= ? THEN 'due'
           ELSE 'current'
         END AS state
       FROM movie_tmdb_data
       JOIN movies ON movies.id = movie_tmdb_data.movie_id
       ORDER BY
         CASE WHEN movie_tmdb_data.refresh_after <= ?
                    OR movie_tmdb_data.data_version < ? THEN 0 ELSE 1 END,
         movie_tmdb_data.refresh_after,
         movies.title
       LIMIT ?`,
    )
      .bind(
        CURRENT_TMDB_DATA_VERSION,
        timestamp,
        timestamp,
        CURRENT_TMDB_DATA_VERSION,
        STATUS_ITEM_LIMIT,
      )
      .all<{
        data_version: number;
        fetched_at: string | null;
        last_refresh_attempt_at: string | null;
        last_refresh_error: string | null;
        last_refresh_status: "failed" | "running" | "succeeded" | null;
        movie_id: string;
        refresh_after: string;
        state: "current" | "due" | "failed" | "never_fetched" | "version_stale";
        title: string;
        tmdb_id: number;
      }>(),
  ]);
  if (!schedule) throw new Error("TMDB refresh schedule is missing");
  return {
    currentDataVersion: CURRENT_TMDB_DATA_VERSION,
    schedule: {
      batchSize: schedule.batch_size,
      enabled: schedule.enabled === 1,
      intervalMinutes: schedule.interval_minutes,
      lastAttempted: schedule.last_attempted_count,
      lastCompletedAt: schedule.last_completed_at,
      lastError: schedule.last_error,
      lastFailed: schedule.last_failed_count,
      lastRateLimited: schedule.last_rate_limited === 1,
      lastRefreshed: schedule.last_refreshed_count,
      lastRemaining: schedule.last_remaining_count,
      lastStartedAt: schedule.last_started_at,
      leaseExpiresAt: schedule.lease_expires_at,
      nextRunAt: schedule.next_run_at,
      running:
        schedule.lease_expires_at !== null &&
        schedule.lease_expires_at > timestamp,
    },
    counts: {
      current: counts?.current ?? 0,
      failed: counts?.failed ?? 0,
      linked: counts?.linked ?? 0,
      pending: counts?.pending ?? 0,
    },
    items: items.results.map((item) => ({
      dataVersion: item.data_version,
      fetchedAt: item.fetched_at,
      lastAttemptAt: item.last_refresh_attempt_at,
      lastError: item.last_refresh_error,
      lastResult: item.last_refresh_status,
      movieId: item.movie_id,
      refreshAfter: item.refresh_after,
      state: item.state,
      title: item.title,
      tmdbId: item.tmdb_id,
    })),
    truncated: (counts?.linked ?? 0) > STATUS_ITEM_LIMIT,
  };
};
