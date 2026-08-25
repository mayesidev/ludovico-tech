ALTER TABLE tmdb_refresh_schedule
ADD COLUMN last_processing_rows_read INTEGER CHECK (
  last_processing_rows_read IS NULL OR last_processing_rows_read >= 0
);

ALTER TABLE tmdb_refresh_schedule
ADD COLUMN last_processing_rows_written INTEGER CHECK (
  last_processing_rows_written IS NULL OR last_processing_rows_written >= 0
);

ALTER TABLE tmdb_refresh_schedule
ADD COLUMN last_processing_retried INTEGER CHECK (
  last_processing_retried IS NULL OR last_processing_retried IN (0, 1)
);
