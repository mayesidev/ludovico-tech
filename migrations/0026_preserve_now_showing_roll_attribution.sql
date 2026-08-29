ALTER TABLE now_showing ADD COLUMN rolled_at TEXT;
ALTER TABLE now_showing ADD COLUMN rolled_by TEXT CHECK (
  rolled_by IS NULL OR length(trim(rolled_by)) BETWEEN 1 AND 200
);

UPDATE now_showing
SET
  rolled_at = CASE
    WHEN movie_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
      )
      THEN updated_at
    ELSE NULL
  END,
  rolled_by = CASE
    WHEN movie_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
      )
      THEN updated_by
    ELSE NULL
  END;

ALTER TABLE now_showing DROP COLUMN collection_id;
ALTER TABLE now_showing DROP COLUMN status;
ALTER TABLE now_showing DROP COLUMN updated_at;
ALTER TABLE now_showing DROP COLUMN updated_by;
