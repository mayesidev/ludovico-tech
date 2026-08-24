ALTER TABLE tmdb_people
ADD COLUMN fetched_at TEXT;

UPDATE tmdb_people
SET fetched_at = updated_at
WHERE fetched_at IS NULL;

CREATE TABLE tmdb_collections (
  tmdb_id INTEGER PRIMARY KEY CHECK (tmdb_id > 0),
  name TEXT NOT NULL CHECK (
    name = trim(name)
    AND length(name) BETWEEN 1 AND 200
  ),
  fetched_at TEXT NOT NULL
);

INSERT INTO tmdb_collections (tmdb_id, name, fetched_at)
SELECT tmdb_collection_id, tmdb_collection_name, source_fetched_at
FROM (
  SELECT
    tmdb_collection_id,
    tmdb_collection_name,
    COALESCE(tmdb_fetched_at, updated_at) AS source_fetched_at,
    ROW_NUMBER() OVER (
      PARTITION BY tmdb_collection_id
      ORDER BY COALESCE(tmdb_fetched_at, updated_at) DESC, id DESC
    ) AS source_rank
  FROM movies
  WHERE tmdb_collection_id IS NOT NULL
    AND tmdb_collection_name IS NOT NULL
)
WHERE source_rank = 1;

CREATE TABLE movie_tmdb_data (
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
  data_version INTEGER NOT NULL DEFAULT 0 CHECK (data_version >= 0),
  CHECK (
    (fetched_at IS NULL AND expires_at IS NULL)
    OR (fetched_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE INDEX idx_movie_tmdb_data_refresh
ON movie_tmdb_data(data_version, refresh_after);

CREATE INDEX idx_movie_tmdb_data_collection
ON movie_tmdb_data(tmdb_collection_id);

INSERT INTO movie_tmdb_data (
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
  data_version
)
SELECT
  id,
  tmdb_id,
  title,
  release_date,
  poster_path,
  runtime_minutes,
  tmdb_collection_id,
  tmdb_fetched_at,
  '1970-01-01T00:00:00.000Z',
  CASE
    WHEN tmdb_fetched_at IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', tmdb_fetched_at, '+175 days')
  END,
  0
FROM movies
WHERE tmdb_id IS NOT NULL;
