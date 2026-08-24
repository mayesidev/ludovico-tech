PRAGMA defer_foreign_keys = TRUE;

DROP TRIGGER movies_version_requires_tmdb_insert;
DROP TRIGGER movies_version_requires_tmdb_update;
DROP TRIGGER movie_tmdb_unlink_clears_version;

CREATE TABLE movie_tmdb_data_next (
  movie_id TEXT PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL UNIQUE CHECK (tmdb_id > 0),
  title TEXT CHECK (
    title IS NULL OR (
      title = trim(title)
      AND length(title) BETWEEN 1 AND 200
    )
  ),
  release_date TEXT,
  poster_path TEXT,
  runtime_minutes INTEGER CHECK (
    runtime_minutes IS NULL OR runtime_minutes > 0
  ),
  tmdb_collection_id INTEGER REFERENCES tmdb_collections(tmdb_id),
  fetched_at TEXT,
  refresh_after TEXT NOT NULL,
  expires_at TEXT,
  contract_id TEXT CHECK (
    contract_id IS NULL OR (
      length(contract_id) = 71
      AND substr(contract_id, 1, 7) = 'sha256:'
      AND substr(contract_id, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  last_refresh_attempt_at TEXT,
  last_refresh_status TEXT CHECK (
    last_refresh_status IS NULL
    OR last_refresh_status IN ('running', 'succeeded', 'failed')
  ),
  last_refresh_error TEXT CHECK (
    last_refresh_error IS NULL OR length(last_refresh_error) <= 200
  ),
  CHECK (
    (fetched_at IS NULL AND expires_at IS NULL)
    OR (fetched_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

INSERT INTO movie_tmdb_data_next (
  movie_id,
  tmdb_id,
  title,
  release_date,
  poster_path,
  runtime_minutes,
  tmdb_collection_id,
  fetched_at,
  refresh_after,
  expires_at,
  contract_id,
  last_refresh_attempt_at,
  last_refresh_status,
  last_refresh_error
)
SELECT
  movie_id,
  tmdb_id,
  title,
  release_date,
  poster_path,
  runtime_minutes,
  tmdb_collection_id,
  fetched_at,
  refresh_after,
  expires_at,
  CASE
    WHEN data_version >= 1
      THEN 'sha256:177f6bf73c02760edc1f2c5e807e3f3eb1fd49901bcf2b6ec52d452b267aa4ff'
    ELSE NULL
  END,
  last_refresh_attempt_at,
  last_refresh_status,
  last_refresh_error
FROM movie_tmdb_data;

DROP TABLE movie_tmdb_data;
ALTER TABLE movie_tmdb_data_next RENAME TO movie_tmdb_data;

CREATE INDEX idx_movie_tmdb_data_refresh
ON movie_tmdb_data(contract_id, refresh_after);
CREATE INDEX idx_movie_tmdb_data_collection
ON movie_tmdb_data(tmdb_collection_id);

CREATE TRIGGER movies_version_requires_tmdb_insert
BEFORE INSERT ON movies
WHEN NEW.version IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM movie_tmdb_data
    WHERE movie_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Movie version requires a TMDB link');
END;

CREATE TRIGGER movies_version_requires_tmdb_update
BEFORE UPDATE OF version ON movies
WHEN NEW.version IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM movie_tmdb_data
    WHERE movie_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Movie version requires a TMDB link');
END;

CREATE TRIGGER movie_tmdb_unlink_clears_version
AFTER DELETE ON movie_tmdb_data
BEGIN
  UPDATE movies
  SET version = NULL,
      version_runtime = NULL,
      version_reference_url = NULL
  WHERE id = OLD.movie_id;
END;

PRAGMA defer_foreign_keys = FALSE;
