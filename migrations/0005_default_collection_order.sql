UPDATE now_showing
SET movie_id = COALESCE(
      (
        SELECT movies.id
        FROM collection_movies
        JOIN movies ON movies.id = collection_movies.movie_id
        LEFT JOIN ratings ON ratings.movie_id = movies.id
        WHERE collection_movies.collection_id = now_showing.collection_id
          AND ratings.id IS NULL
        ORDER BY movies.added_at ASC, movies.id ASC
        LIMIT 1
      ),
      movie_id
    ),
    status = 'ready',
    updated_at = datetime('now')
WHERE status = 'pending_order';
