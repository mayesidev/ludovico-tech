import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

describe("TMDB metadata contract migration", () => {
  it("replaces numeric versions and preserves complete and pending rows", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < "0014_tmdb_metadata_contract.sql",
      )) {
        database.exec(migrationSource(name));
      }
      database.exec(`
        INSERT INTO movies
          (id, title, title_normalized, added_at, updated_at)
        VALUES
          ('complete', 'Complete', 'complete',
           '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
          ('pending', 'Pending', 'pending',
           '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');

        INSERT INTO movie_tmdb_data
          (movie_id, tmdb_id, title, fetched_at, refresh_after, expires_at,
           data_version, last_refresh_status)
        VALUES
          ('complete', 10, 'Provider Complete',
           '2026-08-24T00:00:00.000Z', '2027-01-21T00:00:00.000Z',
           '2027-02-15T00:00:00.000Z', 1, 'succeeded'),
          ('pending', 20, NULL, NULL, '1970-01-01T00:00:00.000Z',
           NULL, 0, NULL);

        UPDATE movies SET version = 'Library Cut' WHERE id = 'complete';
      `);

      database.exec(
        `BEGIN;\n${migrationSource("0014_tmdb_metadata_contract.sql")}\nCOMMIT;`,
      );
      const bootstrapContract = database
        .prepare(
          "SELECT contract_id FROM movie_tmdb_data WHERE movie_id = 'complete'",
        )
        .get() as { contract_id: string };
      expect(bootstrapContract.contract_id).toMatch(/^sha256:[0-9a-f]{64}$/);

      for (const name of migrations.filter(
        (candidate) => candidate > "0014_tmdb_metadata_contract.sql",
      )) {
        database.exec(`BEGIN;\n${migrationSource(name)}\nCOMMIT;`);
      }

      const columns = database
        .prepare("PRAGMA table_info(movie_tmdb_data)")
        .all()
        .map((column) => String(column.name));
      expect(columns).toContain("contract_id");
      expect(columns).not.toContain("data_version");
      const migratedRows = database
        .prepare(
          "SELECT movie_id, contract_id FROM movie_tmdb_data ORDER BY movie_id",
        )
        .all() as Array<{ contract_id: string | null; movie_id: string }>;
      expect(migratedRows).toEqual([
        {
          contract_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          movie_id: "complete",
        },
        { contract_id: null, movie_id: "pending" },
      ]);
      expect(migratedRows[0].contract_id).not.toBe(
        bootstrapContract.contract_id,
      );
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      database
        .prepare("DELETE FROM movie_tmdb_data WHERE movie_id = 'complete'")
        .run();
      expect(
        database
          .prepare("SELECT version FROM movies WHERE id = 'complete'")
          .get(),
      ).toEqual({ version: null });
      expect(() =>
        database
          .prepare(
            "UPDATE movie_tmdb_data SET contract_id = 'manual-version' WHERE movie_id = 'pending'",
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
