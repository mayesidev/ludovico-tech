import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const rollMigration = "0025_remove_roll_history.sql";
const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

describe("roll history migration", () => {
  it("preserves current selection while discarding arbitrary roll history", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < rollMigration,
      )) {
        database.exec(migrationSource(name));
      }

      database.exec(`
        INSERT INTO movies (id, title, added_at, updated_at)
        VALUES ('selected-movie', 'Selected Movie',
                '2026-01-01T00:00:00.000Z',
                '2026-01-01T00:00:00.000Z');

        UPDATE now_showing
        SET rolled_movie_id = 'selected-movie', movie_id = 'selected-movie',
            status = 'ready', rolled_at = '2026-01-02T00:00:00.000Z',
            updated_at = '2026-01-02T00:00:00.000Z',
            updated_by = 'arbitrary-human'
        WHERE id = 1;

        INSERT INTO rolls
          (id, rolled_movie_id, actual_movie_id, created_at, actor_id)
        VALUES ('arbitrary-roll', 'selected-movie', 'selected-movie',
                '2026-01-02T00:00:00.000Z', 'arbitrary-human');
      `);

      database.exec(`BEGIN;\n${migrationSource(rollMigration)}\nCOMMIT;`);

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => String(name));
      const nowShowingColumns = database
        .prepare("PRAGMA table_info(now_showing)")
        .all()
        .map(({ name }) => String(name));
      expect(tables).not.toContain("rolls");
      expect(nowShowingColumns).not.toContain("rolled_movie_id");
      expect(nowShowingColumns).not.toContain("rolled_at");
      expect(
        database
          .prepare(
            `SELECT movie_id, status, updated_at, updated_by
             FROM now_showing WHERE id = 1`,
          )
          .get(),
      ).toEqual({
        movie_id: "selected-movie",
        status: "ready",
        updated_at: "2026-01-02T00:00:00.000Z",
        updated_by: "arbitrary-human",
      });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
