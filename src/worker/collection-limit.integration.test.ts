import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";
import {
  COLLECTION_LIMIT_MESSAGE,
  MAX_COLLECTION_TITLES,
} from "../shared/collection-limits";

const app = createApp();
const timestamp = "2026-09-14T00:00:00.000Z";
const migration = env.TEST_MIGRATIONS.find(
  ({ name }) => name === "0030_collection_title_limit.sql",
)!;
const restoreLimit = () =>
  env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));
const dropLimit = () =>
  env.DB.batch([
    env.DB.prepare("DROP TRIGGER collection_title_limit_insert"),
    env.DB.prepare("DROP TRIGGER collection_title_limit_move"),
  ]);
const request = (path: string, body?: unknown, method = "POST", DB = env.DB) =>
  Promise.resolve(
    app.fetch(
      new Request(`https://ludovico-tech.test/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { ...env, DB },
    ),
  );
const seed = async (
  count: number,
  ids = Array.from({ length: count }, (_, index) => `movie-${index}`),
) => {
  // Recreate the pre-migration state, including legacy oversized collections.
  await dropLimit();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES ('full', 'Café', 'cafe', ?, ?)",
    ).bind(timestamp, timestamp),
    env.DB.prepare(
      "INSERT INTO movies (id, title, added_at, updated_at) SELECT value, 'Original title', ?, ? FROM json_each(?)",
    ).bind(timestamp, timestamp, JSON.stringify(ids)),
    env.DB.prepare(
      "INSERT INTO collection_memberships (collection_id, movie_id, position) SELECT 'full', value, key + 1 FROM json_each(?)",
    ).bind(JSON.stringify(ids)),
  ]);
  await restoreLimit();
  return ids;
};
const countMembers = () =>
  env.DB.prepare(
    "SELECT COUNT(*) AS count FROM collection_memberships WHERE collection_id = 'full'",
  ).first<number>("count");
const snapshot = async () => {
  const tables = [
    "movies",
    "collections",
    "collection_memberships",
    "movie_tmdb_data",
    "now_showing",
    "ratings",
    "roll_candidates",
  ];
  const result: Record<string, unknown> = {};
  for (const table of tables)
    result[table] = (
      await env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
    ).results;
  return result;
};

describe("collection title capacity", () => {
  it("accepts the 1,000th title and rejects another, counting watched titles and normalized aliases", async () => {
    await seed(999);
    await env.DB.prepare(
      "INSERT INTO ratings (movie_id, score, phrase) SELECT movie_id, 4, 'Watched' FROM collection_memberships LIMIT 500",
    ).run();
    expect(
      (
        await request("/movies", {
          title: "Final slot",
          collectionName: "Cafe",
        })
      ).status,
    ).toBe(201);
    const before = await snapshot();
    const response = await request("/movies", {
      title: "One too many",
      collectionName: "CAFÉ",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: COLLECTION_LIMIT_MESSAGE });
    expect(await snapshot()).toEqual(before);
    expect(await countMembers()).toBe(1000);
  });

  it("allows only one of two competing additions to the final slot", async () => {
    await seed(999);
    const responses = await Promise.all([
      request("/movies", { title: "First contender", collectionName: "Cafe" }),
      request("/movies", { title: "Second contender", collectionName: "Café" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await countMembers()).toBe(1000);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM movies").first(
        "count",
      ),
    ).toBe(1000);
  });

  it("rolls back a rejected move together with title, TMDB unlink, sole-member source cleanup and selection", async () => {
    await seed(1000);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES ('source', 'Source', 'source', ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at, updated_at) VALUES ('moving', 'Original moving title', ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO collection_memberships VALUES ('source', 'moving', 1)",
      ),
      env.DB.prepare(
        "INSERT INTO movie_tmdb_data (movie_id, tmdb_id, updated_at, refresh_after) VALUES ('moving', 42, ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "UPDATE now_showing SET movie_id = 'moving', rolled_at = ? WHERE id = 1",
      ).bind(timestamp),
    ]);
    const before = await snapshot();
    const response = await request(
      "/movies/moving",
      { title: "Changed title", tmdbId: null, collectionName: "Cafe" },
      "PATCH",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: COLLECTION_LIMIT_MESSAGE });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a direct membership move into a full collection", async () => {
    await seed(1000);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES ('source', 'Source', 'source', ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('moving', 'Moving', ?)",
      ).bind(timestamp),
      env.DB.prepare(
        "INSERT INTO collection_memberships VALUES ('source', 'moving', 1)",
      ),
    ]);
    await expect(
      env.DB.prepare(
        "UPDATE collection_memberships SET collection_id = 'full', position = 1001 WHERE movie_id = 'moving'",
      ).run(),
    ).rejects.toThrow("Collection title limit exceeded");
    expect(
      await env.DB.prepare(
        "SELECT collection_id FROM collection_memberships WHERE movie_id = 'moving'",
      ).first("collection_id"),
    ).toBe("source");
  });

  it("retains oversized collections, allows edits and moves out, and enables reorder after reduction", async () => {
    const ids = await seed(1001);
    expect(await countMembers()).toBe(1001);
    const partialOrder = await request("/collections/full/order", {
      movieIds: ids.slice(0, 1000),
    });
    expect(partialOrder.status).toBe(400);
    expect(await partialOrder.json()).toEqual({
      error: COLLECTION_LIMIT_MESSAGE,
    });
    expect(
      (await request("/collections/full/order", { movieIds: ids })).status,
    ).toBe(400);
    expect(
      (await request("/movies", { title: "Extra", collectionName: "Cafe" }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(
          "/movies/movie-0",
          { title: "Edited", collectionName: "Café" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/movies/movie-1", { title: "Edited alone" }, "PATCH"))
        .status,
    ).toBe(200);
    expect(
      (
        await request("/movies/movie-2/rate", {
          score: 4,
          phrase: "Still editable",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/movies/movie-1000",
          { collectionName: "Elsewhere" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(await countMembers()).toBe(1000);
    expect(
      (
        await request("/collections/full/order", {
          movieIds: ids.slice(0, 1000).reverse(),
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/movies/movie-999", undefined, "DELETE")).status,
    ).toBe(200);
    expect(
      (
        await request("/movies", {
          title: "Replacement",
          collectionName: "Cafe",
        })
      ).status,
    ).toBe(201);
  });

  it("reorders 1,000 maximally escaped accepted IDs within the documented D1 value size", async () => {
    const ids = Array.from(
      { length: MAX_COLLECTION_TITLES },
      (_, index) =>
        "\u0001".repeat(190) +
        Array.from({ length: 10 }, (_, bit) =>
          (index >> bit) & 1 ? "\u0002" : "\u0003",
        ).join(""),
    );
    expect(new TextEncoder().encode(JSON.stringify(ids)).length).toBe(
      1_203_001,
    );
    await seed(1000, ids);
    expect(
      (
        await request("/collections/full/order", {
          movieIds: [...ids].reverse(),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT movie_id FROM collection_memberships WHERE collection_id = 'full' ORDER BY position",
        ).all<{ movie_id: string }>()
      ).results.map((row) => row.movie_id),
    ).toEqual([...ids].reverse());
  });

  it("rejects excess order IDs with a clear count error before database access", async () => {
    const DB = new Proxy(env.DB, {
      get() {
        throw new Error("Unexpected database access");
      },
    });
    const response = await request(
      "/collections/full/order",
      { movieIds: Array.from({ length: 1001 }, (_, index) => `id-${index}`) },
      "POST",
      DB,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: COLLECTION_LIMIT_MESSAGE });
  });

  it("adds bounded indexed reads without additional writes when filling the final slot", async () => {
    await seed(999);
    await env.DB.prepare(
      "INSERT INTO movies (id, title, added_at) VALUES ('final', 'Final', ?)",
    )
      .bind(timestamp)
      .run();
    const insert = () =>
      env.DB.prepare(
        "INSERT INTO collection_memberships VALUES ('full', 'final', 1000)",
      ).run();
    const capped = await insert();
    await env.DB.prepare(
      "DELETE FROM collection_memberships WHERE movie_id = 'final'",
    ).run();
    await dropLimit();
    const baseline = await insert();
    await restoreLimit();
    expect(capped.meta.rows_written).toBe(baseline.meta.rows_written);
    expect(capped.meta.rows_read - baseline.meta.rows_read).toBeLessThanOrEqual(
      1001,
    );
  });
});
