-- Existing 30-day sessions cannot satisfy the new seven-day absolute and
-- one-day idle policy, so require one fresh sign-in after deployment.
ALTER TABLE auth_sessions
ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

DELETE FROM auth_sessions;
