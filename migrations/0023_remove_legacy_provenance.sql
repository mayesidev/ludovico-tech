PRAGMA defer_foreign_keys = TRUE;

DROP TABLE movie_import_sources;

ALTER TABLE movies DROP COLUMN title_normalized;
ALTER TABLE movies DROP COLUMN added_by;
ALTER TABLE movies DROP COLUMN updated_at;
ALTER TABLE movies DROP COLUMN updated_by;

CREATE TABLE ratings_next (
  movie_id TEXT PRIMARY KEY NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  watched_at TEXT,
  score REAL NOT NULL CHECK (
    score >= 0
    AND score <= 5
    AND score * 2 = CAST(score * 2 AS INTEGER)
  ),
  phrase TEXT NOT NULL CHECK (length(trim(phrase)) BETWEEN 1 AND 120)
);

INSERT INTO ratings_next (movie_id, watched_at, score, phrase)
SELECT movie_id, watched_at, score, phrase
FROM ratings;

DROP TABLE ratings;
ALTER TABLE ratings_next RENAME TO ratings;

CREATE INDEX idx_ratings_watched_history
ON ratings(watched_at DESC, movie_id)
WHERE watched_at IS NOT NULL;

PRAGMA defer_foreign_keys = FALSE;
