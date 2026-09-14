import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTitle } from "../src/shared/normalize-title";
import {
  backfillCollectionNames,
  COLLECTION_NAME_BACKFILL_LIMIT,
  COLLECTION_NAME_READ_SIZE,
  type CollectionNameBackfillDatabase,
} from "./collection-name-backfill";

const migration = "0029_collection_name_backfill.sql";
const timestamp = "2026-08-01T00:00:00.000Z";
let database: DatabaseSync;
let adapter: CollectionNameBackfillDatabase;
const addCollection = (id: string, name: string, key = normalizeTitle(name)) =>
  database
    .prepare(
      `INSERT INTO collections (id, name, name_normalized, order_confirmed, created_at, updated_at, updated_by)
   VALUES (?, ?, ?, 1, ?, ?, 'catalog-import')`,
    )
    .run(id, name, key, timestamp, timestamp);

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql") && name < migration)
    .sort()) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  adapter = {
    query: async (sql) => database.prepare(sql).all(),
    execute: async (sql) => {
      database.exec(sql);
    },
  };
});
afterEach(() => database.close());
const migrate = () =>
  database.exec(readFileSync(`migrations/${migration}`, "utf8"));
const pending = () =>
  expect(
    database.prepare("SELECT completed FROM collection_name_backfill").get(),
  ).toEqual({ completed: 0 });

describe("one-time collection name backfill", () => {
  it("preserves retained names, IDs, memberships, order and attribution on a prior database", async () => {
    addCollection("japanese", "東宝");
    addCollection("accent", "Café");
    addCollection("mixed", "Москва Saga");
    database.exec(`INSERT INTO movies (id, title, added_at) VALUES ('movie', 'Movie', '${timestamp}');
      INSERT INTO collection_movies (collection_id, movie_id, position) VALUES ('japanese', 'movie', 7);`);
    const before = database
      .prepare(
        "SELECT id, name, order_confirmed, created_at, updated_at, updated_by FROM collections ORDER BY id",
      )
      .all();
    migrate();
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 2,
    });
    expect(
      database
        .prepare(
          "SELECT id, name, order_confirmed, created_at, updated_at, updated_by FROM collections ORDER BY id",
        )
        .all(),
    ).toEqual(before);
    expect(
      database.prepare("SELECT * FROM collection_memberships").all(),
    ).toEqual([{ collection_id: "japanese", movie_id: "movie", position: 7 }]);
    expect(
      database
        .prepare("SELECT id, name_key FROM collections ORDER BY id")
        .all(),
    ).toEqual([
      { id: "accent", name_key: "cafe" },
      { id: "japanese", name_key: "東宝" },
      { id: "mixed", name_key: "москва saga" },
    ]);
  });

  it("keeps empty databases usable and skips catalog reads after verified completion", async () => {
    migrate();
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 0,
    });
    const query = vi.fn(adapter.query);
    const execute = vi.fn(adapter.execute);
    expect(await backfillCollectionNames({ query, execute })).toEqual({
      alreadyComplete: true,
      updated: 0,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("collection_name_backfill");
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops conflicting identities before writing or inventing merged memberships", async () => {
    addCollection("legacy", "東宝 Saga");
    addCollection("converted", "東宝 Saga", "東宝 saga");
    migrate();
    const execute = vi.fn(adapter.execute);
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("conflicting identities");
    expect(execute).not.toHaveBeenCalled();
    pending();
  });

  it("stops unexpected legacy keys before writing", async () => {
    addCollection("one", "東宝", "unexpected private key");
    migrate();
    const execute = vi.fn(adapter.execute);
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("unexpected stored key");
    expect(execute).not.toHaveBeenCalled();
    pending();
  });

  it("resumes a partially completed batch without temporary keys", async () => {
    for (let index = 0; index < 101; index++)
      addCollection(
        `collection-${String(index).padStart(3, "0")}`,
        `東宝 ${index}`,
      );
    migrate();
    const execute = vi
      .fn(adapter.execute)
      .mockImplementationOnce(adapter.execute)
      .mockRejectedValueOnce(new Error("interrupted"));
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("interrupted");
    pending();
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM collections WHERE name_key LIKE '東宝 %'",
        )
        .get(),
    ).toEqual({ total: 100 });
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 1,
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM collections WHERE name_key LIKE '東宝 %'",
        )
        .get(),
    ).toEqual({ total: 101 });
  });

  it("verifies conditional writes and refuses completion after a changed row", async () => {
    addCollection("one", "東宝");
    migrate();
    const execute = vi.fn(async (sql: string) => {
      database
        .prepare("UPDATE collections SET name = 'Changed' WHERE id = 'one'")
        .run();
      await adapter.execute(sql);
    });
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("verification failed");
    expect(
      database
        .prepare("SELECT name_key FROM collections WHERE id = 'one'")
        .get(),
    ).toEqual({ name_key: "" });
    pending();
  });

  it("can retry after completion could not be persisted", async () => {
    addCollection("one", "東宝");
    migrate();
    const execute = vi
      .fn(adapter.execute)
      .mockImplementationOnce(adapter.execute)
      .mockRejectedValueOnce(new Error("interrupted"));
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("interrupted");
    pending();
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 0,
    });
  });

  it("preserves apostrophes and embedded NULs in conditional SQL", async () => {
    addCollection("quote'", "東宝's");
    addCollection("nul", "\0🎬");
    migrate();
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 2,
    });
    expect(
      database
        .prepare(
          "SELECT hex(CAST(name_key AS BLOB)) AS key_hex FROM collections WHERE id = 'nul'",
        )
        .get(),
    ).toEqual({ key_hex: Buffer.from("\0🎬").toString("hex").toUpperCase() });
  });

  it("preserves distinct IDs with the same prefix before an embedded NUL", async () => {
    const firstId = "collection\0first";
    const secondId = "collection\0second";
    addCollection(firstId, "東宝");
    addCollection(secondId, "Москва Saga");
    database
      .prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('movie', 'Movie', ?)",
      )
      .run(timestamp);
    database
      .prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, 'movie', 1)",
      )
      .run(firstId);
    migrate();
    expect(await backfillCollectionNames(adapter)).toEqual({
      alreadyComplete: false,
      updated: 2,
    });
    expect(
      database
        .prepare(
          "SELECT hex(CAST(id AS BLOB)) AS id_hex, name_key FROM collections ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id_hex: Buffer.from(firstId).toString("hex").toUpperCase(),
        name_key: "東宝",
      },
      {
        id_hex: Buffer.from(secondId).toString("hex").toUpperCase(),
        name_key: "москва saga",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT hex(CAST(collection_id AS BLOB)) AS id_hex FROM collection_memberships WHERE movie_id = 'movie'",
        )
        .get(),
    ).toEqual({ id_hex: Buffer.from(firstId).toString("hex").toUpperCase() });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preflights and verifies collections across bounded reads", async () => {
    for (let index = 0; index <= COLLECTION_NAME_READ_SIZE; index++) {
      const name = `東宝 ${index}`;
      addCollection(String(index).padStart(5, "0"), name, name);
    }
    migrate();
    const query = vi.fn(adapter.query);
    expect(await backfillCollectionNames({ ...adapter, query })).toEqual({
      alreadyComplete: false,
      updated: 0,
    });
    const collectionReads = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes("FROM collections"));
    expect(collectionReads).toHaveLength(4);
    expect(collectionReads.map((sql) => /OFFSET (\d+)/.exec(sql)?.[1])).toEqual(
      ["0", "1000", "0", "1000"],
    );
  });

  it("finds collisions across read boundaries before any write", async () => {
    for (let index = 0; index < COLLECTION_NAME_READ_SIZE; index++) {
      addCollection(String(index).padStart(5, "0"), `東宝 ${index}`);
    }
    addCollection(
      String(COLLECTION_NAME_READ_SIZE).padStart(5, "0"),
      "東宝 0",
      "東宝 0",
    );
    migrate();
    const execute = vi.fn(adapter.execute);
    await expect(
      backfillCollectionNames({ ...adapter, execute }),
    ).rejects.toThrow("conflicting identities");
    expect(execute).not.toHaveBeenCalled();
    pending();
  });

  it("bounds the first run without modifying an oversized catalog", async () => {
    const rows = Array.from(
      { length: COLLECTION_NAME_BACKFILL_LIMIT + 1 },
      (_, index) => ({
        id_hex: Buffer.from(String(index)).toString("hex"),
        name_hex: Buffer.from(String(index)).toString("hex"),
        key_hex: Buffer.from(String(index)).toString("hex"),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("collection_name_backfill")) return [{ completed: 0 }];
      const match = /LIMIT (\d+) OFFSET (\d+)/.exec(sql)!;
      const offset = Number(match[2]);
      return rows.slice(offset, offset + Number(match[1]));
    });
    const execute = vi.fn();
    await expect(backfillCollectionNames({ query, execute })).rejects.toThrow(
      "reviewed collection limit",
    );
    expect(query.mock.calls.at(-1)![0]).toContain(
      `LIMIT 1 OFFSET ${COLLECTION_NAME_BACKFILL_LIMIT}`,
    );
    expect(query.mock.calls).toHaveLength(12);
    expect(execute).not.toHaveBeenCalled();
  });
});
