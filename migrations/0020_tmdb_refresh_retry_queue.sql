ALTER TABLE movie_tmdb_data
ADD COLUMN retry_queued_at TEXT;

UPDATE movie_tmdb_data
SET retry_queued_at = COALESCE(
  last_refresh_attempt_at,
  fetched_at,
  '1970-01-01T00:00:00.000Z'
)
WHERE last_refresh_status = 'failed';

DROP INDEX idx_movie_tmdb_data_due_queue;

CREATE INDEX idx_movie_tmdb_data_due_queue
ON movie_tmdb_data(
  retry_queued_at,
  refresh_after,
  movie_id,
  contract_id,
  tmdb_id
);
