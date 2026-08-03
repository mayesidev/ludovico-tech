CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS franchises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  order_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  added_at TEXT NOT NULL,
  added_by TEXT,
  source_added_at TEXT,
  source_row INTEGER,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  release_date TEXT,
  poster_path TEXT,
  tmdb_id INTEGER UNIQUE,
  imdb_id TEXT,
  franchise_id TEXT REFERENCES franchises(id),
  prior_viewed INTEGER NOT NULL DEFAULT 0,
  rating_score REAL CHECK (rating_score IS NULL OR (rating_score >= 0 AND rating_score <= 5 AND rating_score * 2 = CAST(rating_score * 2 AS INTEGER))),
  rating_phrase TEXT,
  watched_at TEXT
);

CREATE TABLE IF NOT EXISTS franchise_movies (
  franchise_id TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (franchise_id, movie_id)
);

CREATE TABLE IF NOT EXISTS now_showing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rolled_movie_id TEXT REFERENCES movies(id),
  movie_id TEXT REFERENCES movies(id),
  franchise_id TEXT REFERENCES franchises(id),
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'pending_order', 'ready', 'watched')),
  rolled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rolls (
  id TEXT PRIMARY KEY,
  rolled_movie_id TEXT NOT NULL REFERENCES movies(id),
  actual_movie_id TEXT NOT NULL REFERENCES movies(id),
  franchise_id TEXT REFERENCES franchises(id),
  created_at TEXT NOT NULL,
  actor_id TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movies_watched_at ON movies(watched_at);
CREATE INDEX IF NOT EXISTS idx_movies_franchise_id ON movies(franchise_id);
CREATE INDEX IF NOT EXISTS idx_movies_title_normalized ON movies(title_normalized);
CREATE INDEX IF NOT EXISTS idx_franchise_movies_order ON franchise_movies(franchise_id, position);

INSERT OR IGNORE INTO now_showing (id, status, updated_at) VALUES (1, 'empty', datetime('now'));
