ALTER TABLE movies
ADD COLUMN tmdb_collection_id INTEGER
CHECK (tmdb_collection_id IS NULL OR tmdb_collection_id > 0);

ALTER TABLE movies
ADD COLUMN tmdb_collection_name TEXT
CHECK (
  (tmdb_collection_id IS NULL AND tmdb_collection_name IS NULL)
  OR (
    tmdb_collection_id IS NOT NULL
    AND length(trim(tmdb_collection_name)) BETWEEN 1 AND 200
  )
);

CREATE TRIGGER movies_tmdb_collection_pair_insert
BEFORE INSERT ON movies
WHEN (NEW.tmdb_collection_id IS NULL) <> (NEW.tmdb_collection_name IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'TMDB collection identifier and name must be paired');
END;

CREATE TRIGGER movies_tmdb_collection_pair_update
BEFORE UPDATE OF tmdb_collection_id, tmdb_collection_name ON movies
WHEN (NEW.tmdb_collection_id IS NULL) <> (NEW.tmdb_collection_name IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'TMDB collection identifier and name must be paired');
END;
