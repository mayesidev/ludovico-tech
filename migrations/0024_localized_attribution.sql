ALTER TABLE movies ADD COLUMN added_by TEXT CHECK (
  added_by IS NULL OR length(trim(added_by)) BETWEEN 1 AND 200
);
ALTER TABLE movies ADD COLUMN updated_at TEXT;
ALTER TABLE movies ADD COLUMN updated_by TEXT CHECK (
  updated_by IS NULL OR length(trim(updated_by)) BETWEEN 1 AND 200
);

UPDATE movies
SET
  added_by = (
    SELECT actor_id
    FROM audit_log
    WHERE entity_type = 'movie'
      AND entity_id = movies.id
      AND action = 'created'
    ORDER BY created_at, id
    LIMIT 1
  ),
  updated_at = COALESCE(
    (
      SELECT created_at
      FROM audit_log
      WHERE entity_type = 'movie'
        AND entity_id = movies.id
        AND action IN ('created', 'updated')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ),
    added_at
  ),
  updated_by = (
    SELECT actor_id
    FROM audit_log
    WHERE entity_type = 'movie'
      AND entity_id = movies.id
      AND action IN ('created', 'updated')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  );

ALTER TABLE collections ADD COLUMN created_by TEXT CHECK (
  created_by IS NULL OR length(trim(created_by)) BETWEEN 1 AND 200
);
ALTER TABLE collections ADD COLUMN updated_by TEXT CHECK (
  updated_by IS NULL OR length(trim(updated_by)) BETWEEN 1 AND 200
);

ALTER TABLE ratings ADD COLUMN recorded_at TEXT;
ALTER TABLE ratings ADD COLUMN recorded_by TEXT CHECK (
  recorded_by IS NULL OR length(trim(recorded_by)) BETWEEN 1 AND 200
);

UPDATE ratings
SET
  recorded_at = (
    SELECT created_at
    FROM audit_log
    WHERE entity_type = 'movie'
      AND entity_id = ratings.movie_id
      AND action = 'rated'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ),
  recorded_by = (
    SELECT actor_id
    FROM audit_log
    WHERE entity_type = 'movie'
      AND entity_id = ratings.movie_id
      AND action = 'rated'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  );

ALTER TABLE now_showing ADD COLUMN updated_by TEXT CHECK (
  updated_by IS NULL OR length(trim(updated_by)) BETWEEN 1 AND 200
);
ALTER TABLE movie_tmdb_data ADD COLUMN updated_at TEXT;
ALTER TABLE movie_tmdb_data ADD COLUMN updated_by TEXT CHECK (
  updated_by IS NULL OR length(trim(updated_by)) BETWEEN 1 AND 200
);
ALTER TABLE tmdb_refresh_schedule ADD COLUMN updated_by TEXT CHECK (
  updated_by IS NULL OR length(trim(updated_by)) BETWEEN 1 AND 200
);

DROP TABLE audit_log;
