import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const cleanupMigration = "0023_remove_legacy_provenance.sql";
const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

const columns = (database: DatabaseSync, table: string) =>
  database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String(column.name));

describe("legacy provenance cleanup migration", () => {
  it("removes unconsumed data while preserving application state", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < cleanupMigration,
      )) {
        database.exec(migrationSource(name));
      }

      database.exec(`
        INSERT INTO users (id, email, created_at)
        VALUES ('user-1', 'user@example.com', '2026-08-01T00:00:00.000Z');

        INSERT INTO collections
          (id, name, name_normalized, order_confirmed, created_at, updated_at)
        VALUES
          ('collection-1', 'Preserved Collection', 'preserved collection', 1,
           '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z');

        INSERT INTO movies
          (id, title, title_normalized, added_at, added_by, updated_at,
           updated_by, imdb_id)
        VALUES
          ('movie-1', 'Preserved Movie', 'preserved movie',
           '2026-08-01T00:00:00.000Z', 'user-1',
           '2026-08-02T00:00:00.000Z', 'user-1', 'tt0000042');

        INSERT INTO movie_import_sources
          (source_key, movie_id, source_row, submitted_at, prior_viewed,
           imported_at)
        VALUES
          ('source-1', 'movie-1', 2, '2026-08-01T00:00:00.000Z', 1,
           '2026-08-02T00:00:00.000Z');

        INSERT INTO collection_movies (collection_id, movie_id, position)
        VALUES ('collection-1', 'movie-1', 1);

        INSERT INTO ratings
          (id, movie_id, recorded_at, watched_at, score, phrase, source,
           recorded_by)
        VALUES
          ('rating-1', 'movie-1', '2026-08-03T00:00:00.000Z',
           '2026-08-04T00:00:00.000Z', 4.5, 'Preserved rating',
           'application', 'user-1');

        UPDATE now_showing
        SET rolled_movie_id = 'movie-1', movie_id = 'movie-1',
            collection_id = 'collection-1', status = 'watched',
            rolled_at = '2026-08-03T00:00:00.000Z',
            updated_at = '2026-08-04T00:00:00.000Z'
        WHERE id = 1;

        INSERT INTO rolls
          (id, rolled_movie_id, actual_movie_id, collection_id, created_at,
           actor_id)
        VALUES
          ('roll-1', 'movie-1', 'movie-1', 'collection-1',
           '2026-08-03T00:00:00.000Z', 'user-1');

        INSERT INTO audit_log
          (id, entity_type, entity_id, action, actor_id, created_at,
           details_json)
        VALUES
          ('audit-1', 'movie', 'movie-1', 'rated', 'user-1',
           '2026-08-04T00:00:00.000Z', '{"score":4.5}');

        INSERT INTO movie_tmdb_data (movie_id, tmdb_id, refresh_after)
        VALUES ('movie-1', 42, '1970-01-01T00:00:00.000Z');
      `);

      database.exec(`BEGIN;\n${migrationSource(cleanupMigration)}\nCOMMIT;`);

      expect(columns(database, "movies")).toEqual([
        "id",
        "title",
        "added_at",
        "imdb_id",
        "version",
        "version_runtime",
        "version_reference_url",
      ]);
      expect(columns(database, "ratings")).toEqual([
        "movie_id",
        "watched_at",
        "score",
        "phrase",
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'movie_import_sources'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        database
          .prepare(
            `SELECT movies.title, movies.added_at, movies.imdb_id,
                    ratings.watched_at, ratings.score, ratings.phrase,
                    collections.name AS collection_name,
                    collection_movies.position, now_showing.status,
                    rolls.id AS roll_id, audit_log.actor_id,
                    movie_tmdb_data.tmdb_id
             FROM movies
             JOIN ratings ON ratings.movie_id = movies.id
             JOIN collection_movies ON collection_movies.movie_id = movies.id
             JOIN collections ON collections.id = collection_movies.collection_id
             JOIN now_showing ON now_showing.movie_id = movies.id
             JOIN rolls ON rolls.actual_movie_id = movies.id
             JOIN audit_log ON audit_log.entity_id = movies.id
             JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id`,
          )
          .get(),
      ).toEqual({
        actor_id: "user-1",
        added_at: "2026-08-01T00:00:00.000Z",
        collection_name: "Preserved Collection",
        imdb_id: "tt0000042",
        phrase: "Preserved rating",
        position: 1,
        roll_id: "roll-1",
        score: 4.5,
        status: "watched",
        title: "Preserved Movie",
        tmdb_id: 42,
        watched_at: "2026-08-04T00:00:00.000Z",
      });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
