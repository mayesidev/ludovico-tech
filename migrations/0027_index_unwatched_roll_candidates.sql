CREATE TABLE roll_candidates (
  slot INTEGER PRIMARY KEY CHECK (slot > 0),
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE
);

INSERT INTO roll_candidates (slot, movie_id)
SELECT ROW_NUMBER() OVER (ORDER BY movies.rowid), movies.id
FROM movies
LEFT JOIN ratings ON ratings.movie_id = movies.id
WHERE ratings.movie_id IS NULL;

CREATE TRIGGER add_roll_candidate_after_movie_insert
AFTER INSERT ON movies
BEGIN
  INSERT INTO roll_candidates (slot, movie_id)
  VALUES (
    (SELECT COALESCE(MAX(slot), 0) + 1 FROM roll_candidates),
    NEW.id
  );
END;

CREATE TRIGGER compact_roll_candidates_after_delete
AFTER DELETE ON roll_candidates
WHEN OLD.slot < COALESCE((SELECT MAX(slot) FROM roll_candidates), 0)
BEGIN
  UPDATE roll_candidates
  SET slot = OLD.slot
  WHERE slot = (SELECT MAX(slot) FROM roll_candidates);
END;

CREATE TRIGGER remove_roll_candidate_after_rating_insert
AFTER INSERT ON ratings
BEGIN
  DELETE FROM roll_candidates WHERE movie_id = NEW.movie_id;
END;

CREATE TRIGGER restore_roll_candidate_after_rating_delete
AFTER DELETE ON ratings
WHEN EXISTS (SELECT 1 FROM movies WHERE id = OLD.movie_id)
BEGIN
  INSERT OR IGNORE INTO roll_candidates (slot, movie_id)
  VALUES (
    (SELECT COALESCE(MAX(slot), 0) + 1 FROM roll_candidates),
    OLD.movie_id
  );
END;
