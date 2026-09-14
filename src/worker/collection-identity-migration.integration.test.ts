import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const timestamp = "2026-08-01T00:00:00.000Z";
const migration = env.TEST_MIGRATIONS.find(
  ({ name }) => name === "0029_collection_name_backfill.sql",
)!;
const applyCutover = () =>
  env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));

// The shared setup has applied the complete release. Recreate the two prior names
// so the delayed statements are prepared against the actual pre-cutover D1 schema.
const restorePriorNames = () =>
  env.DB.batch([
    env.DB.prepare(
      "ALTER TABLE collections RENAME COLUMN name_key TO name_normalized",
    ),
    env.DB.prepare(
      "ALTER TABLE collection_memberships RENAME TO collection_movies",
    ),
    env.DB.prepare("DROP TABLE collection_name_backfill"),
  ]);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("D1 collection identity cutover", () => {
  it("rejects a paused legacy collection creation batch after the column rename", async () => {
    await restorePriorNames();
    const statements = [
      env.DB.prepare(
        `INSERT INTO collections (id, name, name_normalized, created_at, updated_at)
        VALUES ('old-collection', '東宝', '', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('old-movie', 'Delayed movie', ?)",
      ).bind(timestamp),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES ('old-collection', 'old-movie', 1)",
      ),
    ];
    const resume = deferred();
    const pending = resume.promise.then(() => env.DB.batch(statements));
    const rejection = expect(pending).rejects.toThrow();
    await applyCutover();
    resume.resolve();
    await rejection;
    expect(
      await env.DB.prepare("SELECT id FROM collections").all(),
    ).toMatchObject({ results: [] });
    expect(await env.DB.prepare("SELECT id FROM movies").all()).toMatchObject({
      results: [],
    });
    expect(
      await env.DB.prepare("SELECT * FROM collection_memberships").all(),
    ).toMatchObject({ results: [] });
  });

  it("rolls back a paused legacy batch that resolved its collection ID before cutover", async () => {
    await restorePriorNames();
    await env.DB.prepare(
      `INSERT INTO collections (id, name, name_normalized, created_at, updated_at)
      VALUES ('retained-collection', '東宝', '', ?, ?)`,
    )
      .bind(timestamp, timestamp)
      .run();
    const collection = await env.DB.prepare(
      "SELECT id FROM collections WHERE name_normalized = ''",
    ).first<{ id: string }>();
    expect(collection?.id).toBe("retained-collection");
    const statements = [
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('old-movie', 'Delayed movie', ?)",
      ).bind(timestamp),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, 'old-movie', 1)",
      ).bind(collection!.id),
    ];
    const resume = deferred();
    const pending = resume.promise.then(() => env.DB.batch(statements));
    const rejection = expect(pending).rejects.toThrow();
    await applyCutover();
    await env.DB.prepare(
      "UPDATE collections SET name_key = '東宝' WHERE id = ?",
    )
      .bind(collection!.id)
      .run();
    resume.resolve();
    await rejection;
    expect(await env.DB.prepare("SELECT id FROM movies").all()).toMatchObject({
      results: [],
    });
    expect(
      await env.DB.prepare("SELECT * FROM collection_memberships").all(),
    ).toMatchObject({ results: [] });
    expect(
      await env.DB.prepare("SELECT id, name_key FROM collections").first(),
    ).toEqual({ id: collection!.id, name_key: "東宝" });
  });

  it("preserves relationship constraints, maintained counts, and roll eligibility", async () => {
    await restorePriorNames();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO collections (id, name, name_normalized, order_confirmed, created_at, updated_at)
        VALUES ('retained', 'Saga', 'saga', 1, ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('first', 'First', ?), ('second', 'Second', ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES ('retained', 'first', 1), ('retained', 'second', 2)",
      ),
      env.DB.prepare(
        "UPDATE now_showing SET movie_id = 'first', rolled_at = ? WHERE id = 1",
      ).bind(timestamp),
    ]);
    const before = await env.DB.prepare(
      "SELECT * FROM collection_movies ORDER BY position",
    ).all();
    const candidates = await env.DB.prepare(
      "SELECT * FROM roll_candidates ORDER BY movie_id",
    ).all();
    await applyCutover();
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM collection_memberships ORDER BY position",
        ).all()
      ).results,
    ).toEqual(before.results);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM roll_candidates ORDER BY movie_id",
        ).all()
      ).results,
    ).toEqual(candidates.results);
    expect(
      await env.DB.prepare("PRAGMA foreign_key_check").all(),
    ).toMatchObject({ results: [] });
    expect(
      await env.DB.prepare(
        "SELECT movie_id FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({ movie_id: "first" });
    await expect(
      env.DB.prepare(
        `INSERT INTO collections (id, name, name_key, created_at, updated_at)
      VALUES ('duplicate-key', 'Saga', 'saga', ?, ?)`,
      )
        .bind(timestamp, timestamp)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE collection_memberships SET position = 1 WHERE movie_id = 'second'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE collection_memberships SET collection_id = 'missing' WHERE movie_id = 'second'",
      ).run(),
    ).rejects.toThrow("FOREIGN KEY");
    await env.DB.prepare(
      "INSERT INTO ratings (movie_id, score, phrase) VALUES ('first', 4, 'Watched')",
    ).run();
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM roll_candidates ORDER BY movie_id",
        ).all()
      ).results,
    ).not.toEqual(candidates.results);
    await env.DB.prepare(
      "UPDATE now_showing SET movie_id = NULL WHERE id = 1",
    ).run();
    await env.DB.prepare("DELETE FROM movies WHERE id = 'first'").run();
    expect(
      await env.DB.prepare("SELECT movie_id FROM collection_memberships").all(),
    ).toMatchObject({ results: [{ movie_id: "second" }] });
    expect(
      await env.DB.prepare("PRAGMA foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });
});
