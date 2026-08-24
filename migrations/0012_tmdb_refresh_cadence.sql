CREATE TABLE tmdb_refresh_schedule_next (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (
    interval_minutes BETWEEN 15 AND 10080 AND interval_minutes % 15 = 0
  ),
  batch_size INTEGER NOT NULL DEFAULT 25 CHECK (batch_size BETWEEN 1 AND 50),
  next_run_at TEXT NOT NULL,
  lease_expires_at TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_attempted_count INTEGER NOT NULL DEFAULT 0 CHECK (
    last_attempted_count >= 0
  ),
  last_refreshed_count INTEGER NOT NULL DEFAULT 0 CHECK (
    last_refreshed_count >= 0
  ),
  last_failed_count INTEGER NOT NULL DEFAULT 0 CHECK (last_failed_count >= 0),
  last_remaining_count INTEGER NOT NULL DEFAULT 0 CHECK (
    last_remaining_count >= 0
  ),
  last_rate_limited INTEGER NOT NULL DEFAULT 0 CHECK (
    last_rate_limited IN (0, 1)
  ),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 200),
  updated_at TEXT NOT NULL
);

INSERT INTO tmdb_refresh_schedule_next (
  id,
  enabled,
  interval_minutes,
  batch_size,
  next_run_at,
  lease_expires_at,
  last_started_at,
  last_completed_at,
  last_attempted_count,
  last_refreshed_count,
  last_failed_count,
  last_remaining_count,
  last_rate_limited,
  last_error,
  updated_at
)
SELECT
  id,
  enabled,
  CASE WHEN interval_minutes = 15 THEN 360 ELSE interval_minutes END,
  batch_size,
  CASE
    WHEN interval_minutes != 15 OR last_started_at IS NULL THEN next_run_at
    ELSE strftime(
      '%Y-%m-%dT%H:%M:%fZ',
      last_started_at,
      '+360 minutes'
    )
  END,
  lease_expires_at,
  last_started_at,
  last_completed_at,
  last_attempted_count,
  last_refreshed_count,
  last_failed_count,
  last_remaining_count,
  last_rate_limited,
  last_error,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM tmdb_refresh_schedule;

DROP TABLE tmdb_refresh_schedule;

ALTER TABLE tmdb_refresh_schedule_next RENAME TO tmdb_refresh_schedule;
