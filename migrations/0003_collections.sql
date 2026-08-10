ALTER TABLE franchises RENAME TO collections;

ALTER TABLE franchise_movies RENAME TO collection_movies;
ALTER TABLE collection_movies RENAME COLUMN franchise_id TO collection_id;

ALTER TABLE now_showing RENAME COLUMN franchise_id TO collection_id;
ALTER TABLE rolls RENAME COLUMN franchise_id TO collection_id;

DROP INDEX idx_franchise_movies_order;
CREATE INDEX idx_collection_movies_order
  ON collection_movies(collection_id, position);
