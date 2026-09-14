ALTER TABLE collections RENAME COLUMN name_normalized TO name_key;
ALTER TABLE collection_movies RENAME TO collection_memberships;

CREATE TABLE collection_name_backfill (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
);

INSERT INTO collection_name_backfill (id) VALUES (1);
