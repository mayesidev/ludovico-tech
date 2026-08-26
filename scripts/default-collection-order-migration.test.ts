import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

describe("default collection order migration", () => {
  it("selects the earliest-added unwatched collection movie", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < "0005_default_collection_order.sql",
      )) {
        database.exec(migrationSource(name));
      }
      database.exec(`
        INSERT INTO collections
          (id, name, name_normalized, created_at, updated_at)
        VALUES
          ('collection-1', 'Collection', 'collection',
           '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

        INSERT INTO movies
          (id, title, title_normalized, added_at, updated_at)
        VALUES
          ('later', 'Later', 'later', '2026-08-02T00:00:00.000Z',
           '2026-08-02T00:00:00.000Z'),
          ('earlier', 'Earlier', 'earlier', '2026-08-01T00:00:00.000Z',
           '2026-08-01T00:00:00.000Z');

        INSERT INTO collection_movies (collection_id, movie_id, position)
        VALUES ('collection-1', 'later', 1), ('collection-1', 'earlier', 2);

        UPDATE now_showing
        SET movie_id = 'later', rolled_movie_id = 'later',
            collection_id = 'collection-1', status = 'pending_order'
        WHERE id = 1;
      `);

      database.exec(migrationSource("0005_default_collection_order.sql"));

      expect(
        database
          .prepare(
            "SELECT movie_id, rolled_movie_id, status FROM now_showing WHERE id = 1",
          )
          .get(),
      ).toEqual({
        movie_id: "earlier",
        rolled_movie_id: "later",
        status: "ready",
      });
    } finally {
      database.close();
    }
  });
});
