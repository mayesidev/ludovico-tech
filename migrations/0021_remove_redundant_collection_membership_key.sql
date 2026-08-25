PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE collection_movies_next (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  movie_id TEXT PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (collection_id, position)
);

INSERT INTO collection_movies_next (collection_id, movie_id, position)
SELECT collection_id, movie_id, position
FROM collection_movies;

DROP TABLE collection_movies;
ALTER TABLE collection_movies_next RENAME TO collection_movies;

PRAGMA defer_foreign_keys = FALSE;
