import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sessionMigration = "0031_enforce_session_lifetimes.sql";
const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

describe("session lifetime migration", () => {
  it("invalidates existing sessions and preserves the prior insert shape", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < sessionMigration,
      )) {
        database.exec(migrationSource(name));
      }

      database.exec(`
        INSERT INTO users (id, email, created_at)
        VALUES ('existing-user', 'person@example.test',
                '2026-09-01T00:00:00.000Z');

        INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
        VALUES ('existing-session', 'existing-user',
                '2026-09-01T00:00:00.000Z',
                '2026-10-01T00:00:00.000Z');
      `);

      database.exec(`BEGIN;\n${migrationSource(sessionMigration)}\nCOMMIT;`);

      expect(database.prepare("SELECT * FROM auth_sessions").all()).toEqual([]);

      database.exec(`
        INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
        VALUES ('compatibility-session', 'existing-user',
                '2026-09-14T00:00:00.000Z',
                '2026-10-14T00:00:00.000Z');
      `);
      expect(
        database
          .prepare(
            `SELECT last_active_at FROM auth_sessions
             WHERE id = 'compatibility-session'`,
          )
          .get(),
      ).toEqual({ last_active_at: "1970-01-01T00:00:00.000Z" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
