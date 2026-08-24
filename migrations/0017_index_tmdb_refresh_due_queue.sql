CREATE INDEX idx_movie_tmdb_data_due_queue
ON movie_tmdb_data(refresh_after, movie_id, contract_id, tmdb_id);
