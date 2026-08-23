CREATE TABLE tmdb_people (
  tmdb_id INTEGER PRIMARY KEY CHECK (tmdb_id > 0),
  name TEXT NOT NULL CHECK (
    name = trim(name)
    AND length(name) BETWEEN 1 AND 200
  ),
  updated_at TEXT NOT NULL
);

CREATE TABLE movie_credits (
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  tmdb_person_id INTEGER NOT NULL REFERENCES tmdb_people(tmdb_id),
  credit_type TEXT NOT NULL CHECK (credit_type IN ('cast', 'director')),
  position INTEGER NOT NULL,
  PRIMARY KEY (movie_id, credit_type, position),
  UNIQUE (movie_id, credit_type, tmdb_person_id),
  CHECK (
    (credit_type = 'cast' AND position BETWEEN 1 AND 5)
    OR (credit_type = 'director' AND position BETWEEN 1 AND 3)
  )
);

CREATE INDEX idx_movie_credits_person
ON movie_credits(tmdb_person_id);
