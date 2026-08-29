import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import "./deny-network";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM oauth_states"),
    env.DB.prepare("DELETE FROM tmdb_cache"),
    env.DB.prepare("DELETE FROM now_showing"),
    env.DB.prepare("DELETE FROM ratings"),
    env.DB.prepare("DELETE FROM collection_movies"),
    env.DB.prepare("DELETE FROM movies"),
    env.DB.prepare("DELETE FROM tmdb_people"),
    env.DB.prepare("DELETE FROM tmdb_collections"),
    env.DB.prepare("DELETE FROM collections"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare(
      `UPDATE tmdb_refresh_schedule SET
         enabled = 1,
         interval_minutes = 360,
         batch_size = 25,
         next_run_at = '1970-01-01T00:00:00.000Z',
         lease_expires_at = NULL,
         last_started_at = NULL,
         last_completed_at = NULL,
         last_attempted_count = 0,
         last_refreshed_count = 0,
         last_failed_count = 0,
         last_remaining_count = 0,
         last_rate_limited = 0,
         last_error = NULL,
         updated_at = '1970-01-01T00:00:00.000Z',
         updated_by = NULL
       WHERE id = 1`,
    ),
    env.DB.prepare("INSERT INTO now_showing (id) VALUES (1)"),
  ]);
});
