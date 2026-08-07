PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE franchises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  order_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (order_confirmed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  added_at TEXT NOT NULL,
  added_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  release_date TEXT,
  poster_path TEXT,
  tmdb_id INTEGER UNIQUE,
  tmdb_fetched_at TEXT,
  legacy_imdb_id TEXT UNIQUE
);

CREATE TABLE movie_import_sources (
  source_key TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  prior_viewed INTEGER NOT NULL CHECK (prior_viewed IN (0, 1)),
  imported_at TEXT NOT NULL
);

CREATE TABLE franchise_movies (
  franchise_id TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  PRIMARY KEY (franchise_id, movie_id),
  UNIQUE (franchise_id, position)
);

CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  watched_at TEXT,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 5 AND score * 2 = CAST(score * 2 AS INTEGER)),
  phrase TEXT NOT NULL CHECK (length(trim(phrase)) BETWEEN 1 AND 120),
  source TEXT NOT NULL CHECK (source IN ('application', 'legacy_import')),
  recorded_by TEXT
);

CREATE TABLE now_showing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rolled_movie_id TEXT REFERENCES movies(id),
  movie_id TEXT REFERENCES movies(id),
  franchise_id TEXT REFERENCES franchises(id),
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'pending_order', 'ready', 'watched')),
  rolled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE rolls (
  id TEXT PRIMARY KEY,
  rolled_movie_id TEXT NOT NULL REFERENCES movies(id),
  actual_movie_id TEXT NOT NULL REFERENCES movies(id),
  franchise_id TEXT REFERENCES franchises(id),
  created_at TEXT NOT NULL,
  actor_id TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE tmdb_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_movies_title_normalized ON movies(title_normalized);
CREATE INDEX idx_movie_import_sources_movie ON movie_import_sources(movie_id);
CREATE INDEX idx_franchise_movies_order ON franchise_movies(franchise_id, position);
CREATE INDEX idx_ratings_recorded_at ON ratings(recorded_at);
CREATE INDEX idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX idx_oauth_states_expires_at ON oauth_states(expires_at);
CREATE INDEX idx_tmdb_cache_expires_at ON tmdb_cache(expires_at);

INSERT INTO now_showing (id, status, updated_at) VALUES (1, 'empty', datetime('now'));
