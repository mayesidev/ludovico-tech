import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const attributionMigration = "0024_localized_attribution.sql";
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

describe("localized attribution migration", () => {
  it("migrates arbitrary valid state without inventing unknown actors", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < attributionMigration,
      )) {
        database.exec(migrationSource(name));
      }

      database.exec(`
        INSERT INTO users (id, email, created_at)
        VALUES ('arbitrary-user', 'person@example.test', '2026-01-01T00:00:00.000Z');

        INSERT INTO collections
          (id, name, name_normalized, created_at, updated_at)
        VALUES
          ('arbitrary-collection', 'Arbitrary Collection',
           'arbitrary collection', '2026-01-01T00:00:00.000Z',
           '2026-01-02T00:00:00.000Z');

        INSERT INTO movies (id, title, added_at)
        VALUES
          ('known-movie', 'Known Movie', '2026-01-01T00:00:00.000Z'),
          ('imported-movie', 'Imported Movie', '2025-01-01T00:00:00.000Z');

        INSERT INTO collection_movies (collection_id, movie_id, position)
        VALUES ('arbitrary-collection', 'known-movie', 1);

        INSERT INTO ratings (movie_id, watched_at, score, phrase)
        VALUES
          ('known-movie', '2026-01-03T00:00:00.000Z', 4.5, 'Known rating'),
          ('imported-movie', NULL, 4, 'Imported rating');

        UPDATE now_showing
        SET rolled_movie_id = 'known-movie', movie_id = 'known-movie',
            collection_id = 'arbitrary-collection', status = 'watched',
            rolled_at = '2026-01-02T00:00:00.000Z',
            updated_at = '2026-01-03T00:00:00.000Z'
        WHERE id = 1;

        INSERT INTO rolls
          (id, rolled_movie_id, actual_movie_id, collection_id, created_at,
           actor_id)
        VALUES
          ('arbitrary-roll', 'known-movie', 'known-movie',
           'arbitrary-collection', '2026-01-02T00:00:00.000Z',
           'arbitrary-user');

        INSERT INTO audit_log
          (id, entity_type, entity_id, action, actor_id, created_at)
        VALUES
          ('created-event', 'movie', 'known-movie', 'created',
           'arbitrary-user', '2026-01-01T00:00:00.000Z'),
          ('updated-event', 'movie', 'known-movie', 'updated',
           'arbitrary-user', '2026-01-02T00:00:00.000Z'),
          ('rated-event', 'movie', 'known-movie', 'rated',
           'arbitrary-user', '2026-01-03T00:00:00.000Z');

        INSERT INTO movie_tmdb_data (movie_id, tmdb_id, refresh_after)
        VALUES ('known-movie', 987654, '1970-01-01T00:00:00.000Z');
      `);

      database.exec(
        `BEGIN;\n${migrationSource(attributionMigration)}\nCOMMIT;`,
      );

      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name));
      expect(tableNames).not.toContain("audit_log");
      expect(tableNames).toContain("rolls");
      expect(columns(database, "now_showing")).toContain("rolled_movie_id");
      expect(columns(database, "now_showing")).toContain("rolled_at");

      expect(
        database
          .prepare(
            `SELECT id, added_by, updated_at, updated_by
             FROM movies ORDER BY id`,
          )
          .all(),
      ).toEqual([
        {
          added_by: null,
          id: "imported-movie",
          updated_at: "2025-01-01T00:00:00.000Z",
          updated_by: null,
        },
        {
          added_by: "arbitrary-user",
          id: "known-movie",
          updated_at: "2026-01-02T00:00:00.000Z",
          updated_by: "arbitrary-user",
        },
      ]);
      expect(
        database
          .prepare(
            "SELECT movie_id, recorded_at, recorded_by FROM ratings ORDER BY movie_id",
          )
          .all(),
      ).toEqual([
        { movie_id: "imported-movie", recorded_at: null, recorded_by: null },
        {
          movie_id: "known-movie",
          recorded_at: "2026-01-03T00:00:00.000Z",
          recorded_by: "arbitrary-user",
        },
      ]);
      expect(
        database
          .prepare(
            "SELECT movie_id, collection_id, status, updated_at, updated_by FROM now_showing",
          )
          .get(),
      ).toEqual({
        collection_id: "arbitrary-collection",
        movie_id: "known-movie",
        status: "watched",
        updated_at: "2026-01-03T00:00:00.000Z",
        updated_by: null,
      });

      database.exec(
        "UPDATE tmdb_refresh_schedule SET updated_by = 'automation:tmdb-refresh' WHERE id = 1",
      );
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
