import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const selectionMigration = "0026_preserve_now_showing_roll_attribution.sql";
const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

const databaseBeforeSelectionMigration = () => {
  const database = new DatabaseSync(":memory:");
  for (const name of migrations.filter(
    (candidate) => candidate < selectionMigration,
  )) {
    database.exec(migrationSource(name));
  }
  return database;
};

describe("Now Showing selection migration", () => {
  it("reduces arbitrary current state to one attributed selection", () => {
    const database = databaseBeforeSelectionMigration();
    try {
      database.exec(`
        INSERT INTO movies (id, title, added_at, updated_at)
        VALUES ('selected-movie', 'Selected Movie',
                '2026-01-01T00:00:00.000Z',
                '2026-01-01T00:00:00.000Z');

        UPDATE now_showing
        SET movie_id = 'selected-movie', status = 'ready',
            updated_at = '2026-01-02T00:00:00.000Z',
            updated_by = 'arbitrary-user'
        WHERE id = 1;
      `);

      database.exec(`BEGIN;\n${migrationSource(selectionMigration)}\nCOMMIT;`);

      expect(
        database
          .prepare("PRAGMA table_info(now_showing)")
          .all()
          .map(({ name }) => String(name)),
      ).toEqual(["id", "movie_id", "rolled_at", "rolled_by"]);
      expect(database.prepare("SELECT * FROM now_showing").all()).toEqual([
        {
          id: 1,
          movie_id: "selected-movie",
          rolled_at: "2026-01-02T00:00:00.000Z",
          rolled_by: "arbitrary-user",
        },
      ]);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("does not mislabel a rating update as a roll", () => {
    const database = databaseBeforeSelectionMigration();
    try {
      database.exec(`
        INSERT INTO movies (id, title, added_at, updated_at)
        VALUES ('rated-movie', 'Rated Movie',
                '2026-01-01T00:00:00.000Z',
                '2026-01-01T00:00:00.000Z');
        INSERT INTO ratings (movie_id, score, phrase, recorded_at)
        VALUES ('rated-movie', 4, 'Already shown',
                '2026-01-03T00:00:00.000Z');
        UPDATE now_showing
        SET movie_id = 'rated-movie', status = 'watched',
            updated_at = '2026-01-03T00:00:00.000Z',
            updated_by = 'rating-user'
        WHERE id = 1;
      `);

      database.exec(`BEGIN;\n${migrationSource(selectionMigration)}\nCOMMIT;`);

      expect(
        database
          .prepare(
            "SELECT movie_id, rolled_at, rolled_by FROM now_showing WHERE id = 1",
          )
          .get(),
      ).toEqual({
        movie_id: "rated-movie",
        rolled_at: null,
        rolled_by: null,
      });
    } finally {
      database.close();
    }
  });
});
