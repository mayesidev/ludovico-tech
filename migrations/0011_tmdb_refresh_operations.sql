ALTER TABLE movie_tmdb_data
ADD COLUMN last_refresh_attempt_at TEXT;

ALTER TABLE movie_tmdb_data
ADD COLUMN last_refresh_status TEXT CHECK (
  last_refresh_status IS NULL
  OR last_refresh_status IN ('running', 'succeeded', 'failed')
);

ALTER TABLE movie_tmdb_data
ADD COLUMN last_refresh_error TEXT CHECK (
  last_refresh_error IS NULL OR length(last_refresh_error) <= 200
);

CREATE TABLE tmdb_refresh_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (
    interval_minutes BETWEEN 15 AND 10080
  ),
  batch_size INTEGER NOT NULL DEFAULT 25 CHECK (batch_size BETWEEN 1 AND 25),
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

INSERT INTO tmdb_refresh_schedule (
  id,
  next_run_at,
  updated_at
)
VALUES (
  1,
  '1970-01-01T00:00:00.000Z',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
