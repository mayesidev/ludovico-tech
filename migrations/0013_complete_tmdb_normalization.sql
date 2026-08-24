PRAGMA defer_foreign_keys = TRUE;

DROP TRIGGER movies_tmdb_collection_pair_insert;
DROP TRIGGER movies_tmdb_collection_pair_update;

CREATE TABLE movies_next (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  added_at TEXT NOT NULL,
  added_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  imdb_id TEXT UNIQUE,
  version TEXT CHECK (
    version IS NULL OR length(trim(version)) BETWEEN 1 AND 120
  ),
  version_runtime INTEGER CHECK (
    version_runtime IS NULL OR (
      version IS NOT NULL
      AND version_runtime > 0
    )
  ),
  version_reference_url TEXT CHECK (
    version_reference_url IS NULL OR (
      version IS NOT NULL
      AND length(trim(version_reference_url)) BETWEEN 1 AND 2048
      AND (
        lower(version_reference_url) LIKE 'http://%'
        OR lower(version_reference_url) LIKE 'https://%'
      )
    )
  )
);

CREATE TABLE tmdb_people_next (
  tmdb_id INTEGER PRIMARY KEY CHECK (tmdb_id > 0),
  name TEXT NOT NULL CHECK (
    name = trim(name)
    AND length(name) BETWEEN 1 AND 200
  ),
  fetched_at TEXT NOT NULL
);

CREATE TABLE movie_import_sources_next (
  source_key TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies_next(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  prior_viewed INTEGER NOT NULL CHECK (prior_viewed IN (0, 1)),
  imported_at TEXT NOT NULL
);

CREATE TABLE collection_movies_next (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies_next(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  PRIMARY KEY (collection_id, movie_id),
  UNIQUE (collection_id, position)
);

CREATE TABLE ratings_next (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies_next(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  watched_at TEXT,
  score REAL NOT NULL CHECK (
    score >= 0
    AND score <= 5
    AND score * 2 = CAST(score * 2 AS INTEGER)
  ),
  phrase TEXT NOT NULL CHECK (length(trim(phrase)) BETWEEN 1 AND 120),
  source TEXT NOT NULL CHECK (source IN ('application', 'legacy_import')),
  recorded_by TEXT
);

CREATE TABLE now_showing_next (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rolled_movie_id TEXT REFERENCES movies_next(id),
  movie_id TEXT REFERENCES movies_next(id),
  collection_id TEXT REFERENCES collections(id),
  status TEXT NOT NULL DEFAULT 'empty' CHECK (
    status IN ('empty', 'pending_order', 'ready', 'watched')
  ),
  rolled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE rolls_next (
  id TEXT PRIMARY KEY,
  rolled_movie_id TEXT NOT NULL REFERENCES movies_next(id),
  actual_movie_id TEXT NOT NULL REFERENCES movies_next(id),
  collection_id TEXT REFERENCES collections(id),
  created_at TEXT NOT NULL,
  actor_id TEXT
);

CREATE TABLE movie_credits_next (
  movie_id TEXT NOT NULL REFERENCES movies_next(id) ON DELETE CASCADE,
  tmdb_person_id INTEGER NOT NULL REFERENCES tmdb_people_next(tmdb_id),
  credit_type TEXT NOT NULL CHECK (credit_type IN ('cast', 'director')),
  position INTEGER NOT NULL,
  PRIMARY KEY (movie_id, credit_type, position),
  UNIQUE (movie_id, credit_type, tmdb_person_id),
  CHECK (
    (credit_type = 'cast' AND position BETWEEN 1 AND 5)
    OR (credit_type = 'director' AND position BETWEEN 1 AND 3)
  )
);

CREATE TABLE movie_tmdb_data_next (
  movie_id TEXT PRIMARY KEY REFERENCES movies_next(id) ON DELETE CASCADE,
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

INSERT INTO movies_next (
  id,
  title,
  title_normalized,
  added_at,
  added_by,
  updated_at,
  updated_by,
  imdb_id,
  version,
  version_runtime,
  version_reference_url
)
SELECT
  id,
  title,
  title_normalized,
  added_at,
  added_by,
  updated_at,
  updated_by,
  imdb_id,
  version,
  version_runtime,
  version_reference_url
FROM movies;

INSERT INTO tmdb_people_next (tmdb_id, name, fetched_at)
SELECT tmdb_id, name, COALESCE(fetched_at, updated_at)
FROM tmdb_people;

INSERT INTO movie_import_sources_next
SELECT * FROM movie_import_sources;

INSERT INTO collection_movies_next
SELECT * FROM collection_movies;

INSERT INTO ratings_next
SELECT * FROM ratings;

INSERT INTO now_showing_next
SELECT * FROM now_showing;

INSERT INTO rolls_next
SELECT * FROM rolls;

INSERT INTO movie_credits_next
SELECT * FROM movie_credits;

INSERT INTO movie_tmdb_data_next
SELECT * FROM movie_tmdb_data;

DROP TABLE movie_import_sources;
DROP TABLE collection_movies;
DROP TABLE ratings;
DROP TABLE now_showing;
DROP TABLE rolls;
DROP TABLE movie_credits;
DROP TABLE movie_tmdb_data;
DROP TABLE movies;
DROP TABLE tmdb_people;

ALTER TABLE movies_next RENAME TO movies;
ALTER TABLE tmdb_people_next RENAME TO tmdb_people;
ALTER TABLE movie_import_sources_next RENAME TO movie_import_sources;
ALTER TABLE collection_movies_next RENAME TO collection_movies;
ALTER TABLE ratings_next RENAME TO ratings;
ALTER TABLE now_showing_next RENAME TO now_showing;
ALTER TABLE rolls_next RENAME TO rolls;
ALTER TABLE movie_credits_next RENAME TO movie_credits;
ALTER TABLE movie_tmdb_data_next RENAME TO movie_tmdb_data;

CREATE INDEX idx_movies_title_normalized ON movies(title_normalized);
CREATE INDEX idx_movie_import_sources_movie
ON movie_import_sources(movie_id);
CREATE INDEX idx_collection_movies_order
ON collection_movies(collection_id, position);
CREATE INDEX idx_ratings_recorded_at ON ratings(recorded_at);
CREATE INDEX idx_movie_credits_person ON movie_credits(tmdb_person_id);
CREATE INDEX idx_movie_tmdb_data_refresh
ON movie_tmdb_data(data_version, refresh_after);
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
