CREATE INDEX idx_movies_title_nocase
ON movies(title COLLATE NOCASE, id);

CREATE INDEX idx_ratings_watched_history
ON ratings(watched_at DESC, movie_id)
WHERE watched_at IS NOT NULL;
