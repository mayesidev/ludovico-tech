import type { AppEnv } from "./env";
import {
  countDueTmdbData,
  purgeExpiredTmdbData,
  refreshDueTmdbData,
  type TmdbRefreshReport,
} from "./tmdb-data";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";
import { createD1ProcessingUsage, type D1ProcessingUsage } from "./d1-usage";
import {
  attributionDisplayName,
  TMDB_REFRESH_ATTRIBUTION,
} from "./attribution";

const SCHEDULE_ID = 1;
const LEASE_MS = 20 * 60 * 1000;

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
  last_processing_retried: number | null;
  last_processing_rows_read: number | null;
  last_processing_rows_written: number | null;
  last_started_at: string | null;
  lease_expires_at: string | null;
  next_run_at: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_display_name: string | null;
  updated_by_email: string | null;
};

type ScheduleSummaryRow = ScheduleRow & {
  contract_stale_count: number | null;
  current_count: number | null;
  due_count: number | null;
  expired_count: number | null;
  failed_count: number | null;
  linked_count: number;
  never_fetched_count: number | null;
  pending_count: number | null;
  total_count: number;
};

type TmdbRefreshState =
  | "current"
  | "due"
  | "expired"
  | "failed"
  | "never_fetched"
  | "unlinked"
  | "contract_stale";

type TmdbRefreshStateCounts = Record<TmdbRefreshState, number>;

export type TmdbRefreshRunResult = {
  report: TmdbRefreshReport | null;
  remaining: number | null;
  started: boolean;
};

export const claimTmdbRefresh = async (
  env: AppEnv["Bindings"],
  force = false,
  timestamp = new Date().toISOString(),
  attributedBy = TMDB_REFRESH_ATTRIBUTION,
): Promise<TmdbRefreshClaim | null> => {
  const leaseExpiresAt = addMilliseconds(timestamp, LEASE_MS);
  const row = await env.DB.prepare(
    `UPDATE tmdb_refresh_schedule SET
       lease_expires_at = ?,
       last_started_at = ?,
       last_error = NULL,
       updated_at = ?,
       updated_by = ?
     WHERE id = ?
       AND (? = 1 OR enabled = 1)
       AND (? = 1 OR next_run_at <= ?)
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
     RETURNING interval_minutes, batch_size`,
  )
    .bind(
      leaseExpiresAt,
      timestamp,
      timestamp,
      attributedBy,
      SCHEDULE_ID,
      force ? 1 : 0,
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
  usage: D1ProcessingUsage,
) => {
  const completedAt = new Date().toISOString();
  const nextRunAt = addMilliseconds(
    claim.startedAt,
    claim.intervalMinutes * 60 * 1000,
  );
  const lastError = report.rateLimited
    ? "TMDB rate limited the refresh"
    : (report.haltedReason ??
      (report.failed > 0
        ? `${report.failed} title refresh${report.failed === 1 ? "" : "es"} failed`
        : null));
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
       last_processing_rows_read = ?,
       last_processing_rows_written = ?,
       last_processing_retried = ?,
       last_error = ?,
       updated_at = ?,
       updated_by = ?
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
      usage.rowsRead,
      usage.rowsWritten,
      usage.retried ? 1 : 0,
      lastError,
      completedAt,
      TMDB_REFRESH_ATTRIBUTION,
      SCHEDULE_ID,
      claim.leaseExpiresAt,
    )
    .run();
};

const failClaim = async (
  env: AppEnv["Bindings"],
  claim: TmdbRefreshClaim,
  usage: D1ProcessingUsage,
) => {
  const completedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE tmdb_refresh_schedule SET
       next_run_at = ?,
       lease_expires_at = NULL,
       last_completed_at = ?,
       last_processing_rows_read = ?,
       last_processing_rows_written = ?,
       last_processing_retried = ?,
       last_error = 'Refresh worker failed',
       updated_at = ?,
       updated_by = ?
     WHERE id = ? AND lease_expires_at = ?`,
  )
    .bind(
      addMilliseconds(claim.startedAt, claim.intervalMinutes * 60 * 1000),
      completedAt,
      usage.rowsRead,
      usage.rowsWritten,
      usage.retried ? 1 : 0,
      completedAt,
      TMDB_REFRESH_ATTRIBUTION,
      SCHEDULE_ID,
      claim.leaseExpiresAt,
    )
    .run();
};

export const executeTmdbRefreshClaim = async (
  env: AppEnv["Bindings"],
  claim: TmdbRefreshClaim,
): Promise<TmdbRefreshRunResult> => {
  const usage = createD1ProcessingUsage();
  try {
    const report = await refreshDueTmdbData(
      env,
      claim.startedAt,
      claim.batchSize,
      usage,
    );
    const remaining = await countDueTmdbData(
      env,
      new Date().toISOString(),
      usage,
    );
    await finishClaim(env, claim, report, remaining, usage);
    return { report, remaining, started: true };
  } catch (error) {
    await failClaim(env, claim, usage);
    throw error;
  }
};

export const runTmdbRefresh = async (
  env: AppEnv["Bindings"],
  options: { force?: boolean; timestamp?: string } = {},
): Promise<TmdbRefreshRunResult> => {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const purged = await purgeExpiredTmdbData(env, timestamp);
  if (purged > 0) console.info("Expired TMDB metadata purged", { purged });
  const claim = await claimTmdbRefresh(env, options.force, timestamp);
  if (!claim) return { report: null, remaining: null, started: false };
  return executeTmdbRefreshClaim(env, claim);
};

export type TmdbRefreshQueueInput = {
  dateSearch: string;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  search: string;
  sort:
    | "title"
    | "tmdbId"
    | "state"
    | "fetchedAt"
    | "lastAttemptAt"
    | "refreshAfter"
    | "contractId";
  state: "all" | TmdbRefreshState;
};

const mapSchedule = (schedule: ScheduleRow, timestamp: string) => ({
  audit: {
    updated: {
      at: schedule.updated_at,
      by: attributionDisplayName(
        schedule.updated_by,
        schedule.updated_by_display_name,
        schedule.updated_by_email,
      ),
    },
  },
  batchSize: schedule.batch_size,
  enabled: schedule.enabled === 1,
  intervalMinutes: schedule.interval_minutes,
  lastAttempted: schedule.last_attempted_count,
  lastCompletedAt: schedule.last_completed_at,
  lastError: schedule.last_error,
  lastFailed: schedule.last_failed_count,
  lastRateLimited: schedule.last_rate_limited === 1,
  lastProcessingRetried:
    schedule.last_processing_retried === null
      ? null
      : schedule.last_processing_retried === 1,
  lastProcessingRowsRead: schedule.last_processing_rows_read,
  lastProcessingRowsWritten: schedule.last_processing_rows_written,
  lastRefreshed: schedule.last_refreshed_count,
  lastRemaining: schedule.last_remaining_count,
  lastStartedAt: schedule.last_started_at,
  leaseExpiresAt: schedule.lease_expires_at,
  nextRunAt: schedule.next_run_at,
  running:
    schedule.lease_expires_at !== null && schedule.lease_expires_at > timestamp,
});

const getTmdbRefreshSummaryData = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const currentContractId = await getTmdbMetadataContractId();
  const schedule = await env.DB.prepare(
    `SELECT tmdb_refresh_schedule.*,
       schedule_user.display_name AS updated_by_display_name,
       schedule_user.email AS updated_by_email,
       (SELECT COUNT(*) FROM movies) AS total_count,
       metadata_counts.linked_count,
       metadata_counts.pending_count,
       metadata_counts.current_count,
       metadata_counts.failed_count,
       metadata_counts.never_fetched_count,
       metadata_counts.contract_stale_count,
       metadata_counts.due_count,
       metadata_counts.expired_count
     FROM tmdb_refresh_schedule
     LEFT JOIN users AS schedule_user
       ON schedule_user.id = tmdb_refresh_schedule.updated_by
     CROSS JOIN (
       SELECT COUNT(*) AS linked_count,
         SUM(CASE
          WHEN last_refresh_status = 'failed'
            OR fetched_at IS NULL
            OR refresh_after <= ?
            OR contract_id IS NULL
            OR contract_id <> ?
          THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE
          WHEN COALESCE(last_refresh_status, '') <> 'failed'
            AND expired_at IS NULL
            AND fetched_at IS NOT NULL
            AND refresh_after > ?
            AND contract_id = ?
          THEN 1 ELSE 0 END) AS current_count,
         SUM(CASE
          WHEN expired_at IS NULL AND last_refresh_status = 'failed'
          THEN 1 ELSE 0 END)
           AS failed_count,
         SUM(CASE WHEN expired_at IS NOT NULL THEN 1 ELSE 0 END)
           AS expired_count,
         SUM(CASE
          WHEN COALESCE(last_refresh_status, '') <> 'failed'
            AND expired_at IS NULL
            AND fetched_at IS NULL
          THEN 1 ELSE 0 END) AS never_fetched_count,
         SUM(CASE
          WHEN COALESCE(last_refresh_status, '') <> 'failed'
            AND expired_at IS NULL
            AND fetched_at IS NOT NULL
            AND (contract_id IS NULL OR contract_id <> ?)
          THEN 1 ELSE 0 END) AS contract_stale_count,
         SUM(CASE
          WHEN COALESCE(last_refresh_status, '') <> 'failed'
            AND expired_at IS NULL
            AND fetched_at IS NOT NULL
            AND contract_id = ?
            AND refresh_after <= ?
          THEN 1 ELSE 0 END) AS due_count
       FROM movie_tmdb_data
     ) AS metadata_counts
     WHERE tmdb_refresh_schedule.id = ?`,
  )
    .bind(
      timestamp,
      currentContractId,
      timestamp,
      currentContractId,
      currentContractId,
      currentContractId,
      timestamp,
      SCHEDULE_ID,
    )
    .first<ScheduleSummaryRow>();
  if (!schedule) throw new Error("TMDB refresh schedule is missing");
  const stateCounts: TmdbRefreshStateCounts = {
    contract_stale: schedule.contract_stale_count ?? 0,
    current: schedule.current_count ?? 0,
    due: schedule.due_count ?? 0,
    expired: schedule.expired_count ?? 0,
    failed: schedule.failed_count ?? 0,
    never_fetched: schedule.never_fetched_count ?? 0,
    unlinked: schedule.total_count - schedule.linked_count,
  };
  return {
    stateCounts,
    summary: {
      currentContractId,
      schedule: mapSchedule(schedule, timestamp),
      counts: {
        current: stateCounts.current,
        failed: stateCounts.failed,
        linked: schedule.linked_count,
        pending: schedule.pending_count ?? 0,
        total: schedule.total_count,
        unlinked: stateCounts.unlinked,
      },
    },
  };
};

export const getTmdbRefreshSummary = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => (await getTmdbRefreshSummaryData(env, timestamp)).summary;

export const getTmdbRefreshRunStatus = async (
  env: AppEnv["Bindings"],
  timestamp = new Date().toISOString(),
) => {
  const schedule = await env.DB.prepare(
    `SELECT tmdb_refresh_schedule.*,
       schedule_user.display_name AS updated_by_display_name,
       schedule_user.email AS updated_by_email
     FROM tmdb_refresh_schedule
     LEFT JOIN users AS schedule_user
       ON schedule_user.id = tmdb_refresh_schedule.updated_by
     WHERE tmdb_refresh_schedule.id = ?`,
  )
    .bind(SCHEDULE_ID)
    .first<ScheduleRow>();
  if (!schedule) throw new Error("TMDB refresh schedule is missing");
  return { schedule: mapSchedule(schedule, timestamp) };
};

const tmdbRefreshQueueCte = `
  WITH classified AS (
    SELECT
      movies.id AS movie_id,
      movies.title,
      movie_tmdb_data.tmdb_id,
      movie_tmdb_data.fetched_at,
      movie_tmdb_data.refresh_after,
      movie_tmdb_data.contract_id,
      movie_tmdb_data.last_refresh_attempt_at,
      movie_tmdb_data.last_refresh_status,
      movie_tmdb_data.last_refresh_error,
      CASE
        WHEN movie_tmdb_data.movie_id IS NULL THEN 'unlinked'
        WHEN movie_tmdb_data.expired_at IS NOT NULL THEN 'expired'
        WHEN movie_tmdb_data.last_refresh_status = 'failed' THEN 'failed'
        WHEN movie_tmdb_data.fetched_at IS NULL THEN 'never_fetched'
        WHEN movie_tmdb_data.contract_id IS NULL
             OR movie_tmdb_data.contract_id <> ? THEN 'contract_stale'
        WHEN movie_tmdb_data.refresh_after <= ? THEN 'due'
        ELSE 'current'
      END AS state
    FROM movies
    LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
  ), queue AS (
    SELECT classified.*,
      CASE classified.state
        WHEN 'expired' THEN 0
        WHEN 'failed' THEN 1
        WHEN 'never_fetched' THEN 2
        WHEN 'contract_stale' THEN 3
        WHEN 'due' THEN 4
        WHEN 'unlinked' THEN 5
        ELSE 6
      END AS state_rank
    FROM classified
  )
`;

type TmdbRefreshQueueRow = {
  contract_id: string | null;
  fetched_at: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_error: string | null;
  last_refresh_status: "failed" | "running" | "succeeded" | null;
  movie_id: string;
  refresh_after: string | null;
  state: TmdbRefreshState;
  state_rank: number;
  title: string;
  tmdb_id: number | null;
};

const mapTmdbRefreshQueueRow = (item: TmdbRefreshQueueRow) => ({
  contractId: item.contract_id,
  fetchedAt: item.fetched_at,
  lastAttemptAt: item.last_refresh_attempt_at,
  lastError: item.last_refresh_error,
  lastResult: item.last_refresh_status,
  movieId: item.movie_id,
  refreshAfter: item.refresh_after,
  state: item.state,
  title: item.title,
  tmdbId: item.tmdb_id,
});

const stateRank = {
  expired: 0,
  failed: 1,
  never_fetched: 2,
  contract_stale: 3,
  due: 4,
  unlinked: 5,
  current: 6,
} satisfies Record<TmdbRefreshState, number>;

const stateQuery = (
  state: TmdbRefreshState,
  currentContractId: string,
  timestamp: string,
) => {
  if (state === "unlinked") {
    return {
      bindings: [] as Array<string>,
      sql: `SELECT
        NULL AS contract_id,
        NULL AS fetched_at,
        NULL AS last_refresh_attempt_at,
        NULL AS last_refresh_error,
        NULL AS last_refresh_status,
        movies.id AS movie_id,
        NULL AS refresh_after,
        'unlinked' AS state,
        ${stateRank.unlinked} AS state_rank,
        movies.title,
        NULL AS tmdb_id
      FROM movies
      LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
      WHERE movie_tmdb_data.movie_id IS NULL`,
    };
  }

  const predicates = {
    expired: "movie_tmdb_data.expired_at IS NOT NULL",
    failed: `movie_tmdb_data.expired_at IS NULL
      AND movie_tmdb_data.last_refresh_status = 'failed'`,
    never_fetched: `COALESCE(movie_tmdb_data.last_refresh_status, '') <> 'failed'
      AND movie_tmdb_data.expired_at IS NULL
      AND movie_tmdb_data.fetched_at IS NULL`,
    contract_stale: `COALESCE(movie_tmdb_data.last_refresh_status, '') <> 'failed'
      AND movie_tmdb_data.expired_at IS NULL
      AND movie_tmdb_data.fetched_at IS NOT NULL
      AND (movie_tmdb_data.contract_id IS NULL OR movie_tmdb_data.contract_id <> ?)`,
    due: `COALESCE(movie_tmdb_data.last_refresh_status, '') <> 'failed'
      AND movie_tmdb_data.expired_at IS NULL
      AND movie_tmdb_data.fetched_at IS NOT NULL
      AND movie_tmdb_data.contract_id = ?
      AND movie_tmdb_data.refresh_after <= ?`,
    current: `COALESCE(movie_tmdb_data.last_refresh_status, '') <> 'failed'
      AND movie_tmdb_data.expired_at IS NULL
      AND movie_tmdb_data.fetched_at IS NOT NULL
      AND movie_tmdb_data.contract_id = ?
      AND movie_tmdb_data.refresh_after > ?`,
  } as const;
  const bindings = {
    expired: [] as Array<string>,
    failed: [] as Array<string>,
    never_fetched: [] as Array<string>,
    contract_stale: [currentContractId],
    due: [currentContractId, timestamp],
    current: [currentContractId, timestamp],
  } satisfies Record<Exclude<TmdbRefreshState, "unlinked">, Array<string>>;
  return {
    bindings: bindings[state],
    sql: `SELECT
      movie_tmdb_data.contract_id,
      movie_tmdb_data.fetched_at,
      movie_tmdb_data.last_refresh_attempt_at,
      movie_tmdb_data.last_refresh_error,
      movie_tmdb_data.last_refresh_status,
      movies.id AS movie_id,
      movie_tmdb_data.refresh_after,
      '${state}' AS state,
      ${stateRank[state]} AS state_rank,
      movies.title,
      movie_tmdb_data.tmdb_id
    FROM movie_tmdb_data
    JOIN movies ON movies.id = movie_tmdb_data.movie_id
    WHERE ${predicates[state]}`,
  };
};

const getStateSortedTmdbRefreshQueue = async (
  env: AppEnv["Bindings"],
  input: TmdbRefreshQueueInput,
  currentContractId: string,
  stateCounts: TmdbRefreshStateCounts,
  timestamp: string,
) => {
  const states =
    input.state === "all"
      ? (Object.keys(stateRank) as Array<TmdbRefreshState>).sort(
          (left, right) => stateRank[left] - stateRank[right],
        )
      : [input.state];
  if (input.state === "all" && input.direction === "desc") states.reverse();
  const total = states.reduce((sum, state) => sum + stateCounts[state], 0);
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const pageStart = (page - 1) * input.pageSize;
  const pageEnd = Math.min(pageStart + input.pageSize, total);
  let stateStart = 0;
  const items: TmdbRefreshQueueRow[] = [];

  for (const state of states) {
    const stateEnd = stateStart + stateCounts[state];
    const overlapStart = Math.max(pageStart, stateStart);
    const overlapEnd = Math.min(pageEnd, stateEnd);
    if (overlapStart < overlapEnd) {
      const query = stateQuery(state, currentContractId, timestamp);
      const result = await env.DB.prepare(
        `${query.sql}
         ORDER BY movies.title COLLATE NOCASE ASC, movies.id ASC
         LIMIT ? OFFSET ?`,
      )
        .bind(
          ...query.bindings,
          overlapEnd - overlapStart,
          overlapStart - stateStart,
        )
        .all<TmdbRefreshQueueRow>();
      items.push(...result.results);
    }
    stateStart = stateEnd;
    if (stateStart >= pageEnd) break;
  }

  return {
    items: items.map(mapTmdbRefreshQueueRow),
    pagination: { page, pageSize: input.pageSize, total, totalPages },
  };
};

export const getTmdbRefreshQueue = async (
  env: AppEnv["Bindings"],
  input: TmdbRefreshQueueInput,
  timestamp = new Date().toISOString(),
) => {
  if (input.sort === "state" && !input.search && !input.dateSearch) {
    const { stateCounts, summary } = await getTmdbRefreshSummaryData(
      env,
      timestamp,
    );
    return getStateSortedTmdbRefreshQueue(
      env,
      input,
      summary.currentContractId,
      stateCounts,
      timestamp,
    );
  }
  const currentContractId = await getTmdbMetadataContractId();
  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  if (input.state !== "all") {
    filters.push("state = ?");
    bindings.push(input.state);
  }
  if (input.search) {
    const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
    const fields = [
      "title",
      "COALESCE(CAST(tmdb_id AS TEXT), '—')",
      `CASE state
         WHEN 'current' THEN 'Current'
         WHEN 'due' THEN 'Due'
         WHEN 'expired' THEN 'Expired'
         WHEN 'failed' THEN 'Failed'
         WHEN 'never_fetched' THEN 'Never fetched'
         WHEN 'unlinked' THEN 'Not linked'
         ELSE 'Contract stale'
       END`,
      "COALESCE(last_refresh_error, '')",
      "COALESCE(fetched_at, CASE WHEN state = 'unlinked' THEN '—' ELSE 'Never' END)",
      "COALESCE(last_refresh_attempt_at, '—')",
      `COALESCE(refresh_after,
         CASE WHEN state IN ('due', 'expired', 'never_fetched', 'contract_stale')
              THEN 'Due now' ELSE '—' END)`,
      "COALESCE(contract_id, '—')",
    ];
    const clauses = fields.map(
      (field) => `LOWER(${field}) LIKE LOWER(?) ESCAPE '\\'`,
    );
    bindings.push(...fields.map(() => pattern));
    if (input.dateSearch) {
      clauses.push(
        "SUBSTR(fetched_at, 1, 16) = SUBSTR(?, 1, 16)",
        "SUBSTR(last_refresh_attempt_at, 1, 16) = SUBSTR(?, 1, 16)",
        "SUBSTR(refresh_after, 1, 16) = SUBSTR(?, 1, 16)",
      );
      bindings.push(input.dateSearch, input.dateSearch, input.dateSearch);
    }
    filters.push(`(${clauses.join(" OR ")})`);
  } else if (input.dateSearch) {
    filters.push(`(
      SUBSTR(fetched_at, 1, 16) = SUBSTR(?, 1, 16)
      OR SUBSTR(last_refresh_attempt_at, 1, 16) = SUBSTR(?, 1, 16)
      OR SUBSTR(refresh_after, 1, 16) = SUBSTR(?, 1, 16)
    )`);
    bindings.push(input.dateSearch, input.dateSearch, input.dateSearch);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const baseBindings = [currentContractId, timestamp];
  let counts: { total: number } | null;
  if (!input.search && !input.dateSearch) {
    const simpleCounts = {
      all: {
        sql: "SELECT COUNT(*) AS total FROM movies",
        bindings: [] as Array<string>,
      },
      unlinked: {
        sql: `SELECT COUNT(*) AS total
              FROM movies
              LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
              WHERE movie_tmdb_data.movie_id IS NULL`,
        bindings: [] as Array<string>,
      },
      failed: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE expired_at IS NULL
                AND last_refresh_status = 'failed'`,
        bindings: [] as Array<string>,
      },
      expired: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE expired_at IS NOT NULL`,
        bindings: [] as Array<string>,
      },
      never_fetched: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE COALESCE(last_refresh_status, '') <> 'failed'
                AND expired_at IS NULL
                AND fetched_at IS NULL`,
        bindings: [] as Array<string>,
      },
      contract_stale: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE COALESCE(last_refresh_status, '') <> 'failed'
                AND expired_at IS NULL
                AND fetched_at IS NOT NULL
                AND (contract_id IS NULL
                     OR contract_id < ?
                     OR contract_id > ?)`,
        bindings: [currentContractId, currentContractId],
      },
      due: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE COALESCE(last_refresh_status, '') <> 'failed'
                AND expired_at IS NULL
                AND fetched_at IS NOT NULL
                AND contract_id = ?
                AND refresh_after <= ?`,
        bindings: [currentContractId, timestamp],
      },
      current: {
        sql: `SELECT COUNT(*) AS total FROM movie_tmdb_data
              WHERE COALESCE(last_refresh_status, '') <> 'failed'
                AND expired_at IS NULL
                AND fetched_at IS NOT NULL
                AND contract_id = ?
                AND refresh_after > ?`,
        bindings: [currentContractId, timestamp],
      },
    } as const;
    const query = simpleCounts[input.state];
    counts = await env.DB.prepare(query.sql)
      .bind(...query.bindings)
      .first<{ total: number }>();
  } else {
    counts = await env.DB.prepare(
      `${tmdbRefreshQueueCte} SELECT COUNT(*) AS total FROM queue ${where}`,
    )
      .bind(...baseBindings, ...bindings)
      .first<{ total: number }>();
  }
  const total = counts?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const sortExpressions = {
    title: "title COLLATE NOCASE",
    tmdbId: "tmdb_id",
    state: "state_rank",
    fetchedAt: "fetched_at",
    lastAttemptAt: "last_refresh_attempt_at",
    refreshAfter: "refresh_after",
    contractId: "contract_id",
  } as const;
  const sortExpression = sortExpressions[input.sort];
  const direction = input.direction === "asc" ? "ASC" : "DESC";
  const nullsLast =
    input.sort === "title" || input.sort === "state"
      ? ""
      : `${sortExpression} IS NULL ASC, `;
  const result = await env.DB.prepare(
    `${tmdbRefreshQueueCte}
     SELECT * FROM queue ${where}
     ORDER BY ${nullsLast}${sortExpression} ${direction}, title COLLATE NOCASE ASC, movie_id ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(
      ...baseBindings,
      ...bindings,
      input.pageSize,
      (page - 1) * input.pageSize,
    )
    .all<TmdbRefreshQueueRow>();
  return {
    items: result.results.map(mapTmdbRefreshQueueRow),
    pagination: {
      page,
      pageSize: input.pageSize,
      total,
      totalPages,
    },
  };
};

export const getTmdbRefreshOverview = async (
  env: AppEnv["Bindings"],
  input: TmdbRefreshQueueInput,
  timestamp = new Date().toISOString(),
) => {
  const { stateCounts, summary } = await getTmdbRefreshSummaryData(
    env,
    timestamp,
  );
  const queue =
    input.sort === "state" && !input.search && !input.dateSearch
      ? await getStateSortedTmdbRefreshQueue(
          env,
          input,
          summary.currentContractId,
          stateCounts,
          timestamp,
        )
      : await getTmdbRefreshQueue(env, input, timestamp);
  return { queue, summary };
};
