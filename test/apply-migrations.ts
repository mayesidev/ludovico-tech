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
    env.DB.prepare("DELETE FROM audit_log"),
    env.DB.prepare("DELETE FROM rolls"),
    env.DB.prepare("DELETE FROM now_showing"),
    env.DB.prepare("DELETE FROM ratings"),
    env.DB.prepare("DELETE FROM movie_import_sources"),
    env.DB.prepare("DELETE FROM collection_movies"),
    env.DB.prepare("DELETE FROM movies"),
    env.DB.prepare("DELETE FROM collections"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare(
      "INSERT INTO now_showing (id, status, updated_at) VALUES (1, 'empty', datetime('now'))",
    ),
  ]);
});
