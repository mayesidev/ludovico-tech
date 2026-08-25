ALTER TABLE movie_tmdb_data ADD COLUMN expired_at TEXT;

CREATE INDEX idx_movie_tmdb_data_expiration
ON movie_tmdb_data(expires_at, movie_id)
WHERE expires_at IS NOT NULL AND expired_at IS NULL;
