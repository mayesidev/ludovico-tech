import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

const app = createApp();
const timestamp = "2026-08-06T00:00:00.000Z";
const collectionId = "rotation-collection";
const otherCollectionId = "other-collection";
const movieIds = ["chapter-one", "chapter-two", "chapter-three"];

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

const seed = async (confirmed = true, ids = movieIds) => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, order_confirmed, created_at, updated_at)
       VALUES (?, 'Rotation collection', 'rotation collection', ?, ?, ?),
              (?, 'Other collection', 'other collection', 1, ?, ?)`,
    ).bind(
      collectionId,
      Number(confirmed),
      timestamp,
      timestamp,
      otherCollectionId,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO movies (id, title, added_at, updated_at)
       SELECT value, value, ?, ? FROM json_each(?)`,
    ).bind(timestamp, timestamp, JSON.stringify(ids)),
    env.DB.prepare(
      `INSERT INTO collection_movies (collection_id, movie_id, position)
       SELECT ?, value, key + 1 FROM json_each(?)`,
    ).bind(collectionId, JSON.stringify(ids)),
  ]);
};

const state = () =>
  env.DB.prepare(
    "SELECT movie_id, rolled_at, rolled_by FROM now_showing WHERE id = 1",
  ).first<{
    movie_id: string | null;
    rolled_at: string | null;
    rolled_by: string | null;
  }>();

const select = (movieId: string) =>
  env.DB.prepare(
    "UPDATE now_showing SET movie_id = ?, rolled_at = ?, rolled_by = 'original-user' WHERE id = 1",
  )
    .bind(movieId, timestamp)
    .run();

const rate = async (movieId: string) => {
  const response = await request(`/movies/${movieId}/rate`, {
    score: 4,
    phrase: "Ready for the next chapter",
  });
  expect(response.status).toBe(200);
};

const move = async (movieId: string) => {
  const response = await request(
    `/movies/${movieId}`,
    {
      collectionName: "Other collection",
    },
    "PATCH",
  );
  expect(response.status).toBe(200);
};

const remove = async (movieId: string) => {
  const response = await request(`/movies/${movieId}`, undefined, "DELETE");
  expect(response.status).toBe(200);
};

const reorder = (ids: string[] = [...movieIds].reverse(), DB = env.DB) =>
  request(`/collections/${collectionId}/order`, { movieIds: ids }, "POST", DB);

// Pause only the selected request immediately before its real D1 write. Other
// requests continue against the same database, then the original SQL resumes.
const deferredWrite = (kind: "selection" | "order") => {
  let release!: () => void;
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let sampledId: string | undefined;
  let paused = false;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const queries = new WeakMap<D1PreparedStatement, string>();
  const pause = async () => {
    if (paused) return;
    paused = true;
    reached();
    await resumed;
  };
  const wrap = (
    statement: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: Parameters<D1PreparedStatement["bind"]>) => {
            if (sql.includes("WITH eligible_roll"))
              sampledId = String(values[0]);
            return wrap(target.bind(...values), sql);
          };
        }
        if (property === "run") {
          return async () => {
            if (kind === "selection" && sql.includes("UPDATE now_showing"))
              await pause();
            return target.run();
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(wrapped, statement);
    queries.set(wrapped, sql);
    return wrapped;
  };
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => wrap(target.prepare(sql), sql);
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (
            kind === "order" &&
            statements.some((statement) =>
              queries.get(statement)?.includes("UPDATE collection_movies"),
            )
          )
            await pause();
          return target.batch(
            statements.map(
              (statement) => originals.get(statement) ?? statement,
            ),
          );
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { DB, ready, release, sampledId: () => sampledId };
};

const duringSelection = async (
  path: "/roll" | "/next",
  change: (sampledId: string | undefined) => Promise<void>,
) => {
  const deferred = deferredWrite("selection");
  const pending = request(path, undefined, "POST", deferred.DB);
  let response!: Response;
  try {
    await deferred.ready;
    await change(deferred.sampledId());
  } finally {
    deferred.release();
    response = await pending;
  }
  return response;
};

describe("selection uses current collection eligibility", () => {
  it.each([false, true])(
    "uses a saved reorder when a roll was deferred (previously confirmed: %s)",
    async (confirmed) => {
      await seed(confirmed);
      const response = await duringSelection("/roll", async () => {
        expect((await reorder()).status).toBe(200);
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        nowShowing: { movie_id: movieIds[2], status: "ready" },
      });
      expect((await state())?.movie_id).toBe(movieIds[2]);
    },
  );

  it("preserves default added-time ordering with an ID tie-breaker", async () => {
    await seed(false, ["z-last", "b-earlier", "a-earlier"]);
    await env.DB.prepare(
      "UPDATE movies SET added_at = '2026-08-01T00:00:00.000Z' WHERE id IN ('a-earlier', 'b-earlier')",
    ).run();
    const response = await request("/roll");
    expect(response.status).toBe(200);
    expect((await state())?.movie_id).toBe("a-earlier");
  });

  it.each(["rate", "remove", "reassign"] as const)(
    "rejects a roll whose sampled movie changes before commit: %s",
    async (change) => {
      await seed();
      const response = await duringSelection("/roll", async (sampledId) => {
        expect(sampledId).toBeTruthy();
        if (change === "rate") await rate(sampledId!);
        if (change === "remove") await remove(sampledId!);
        if (change === "reassign") await move(sampledId!);
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "Someone else is already choosing the next movie",
      });
      expect(await state()).toEqual({
        movie_id: null,
        rolled_at: null,
        rolled_by: null,
      });
    },
  );

  it("rejects a standalone roll rated before commit", async () => {
    await seed();
    await env.DB.prepare("DELETE FROM collection_movies").run();
    const response = await duringSelection("/roll", async (sampledId) => {
      await rate(sampledId!);
    });
    expect(response.status).toBe(409);
    expect((await state())?.movie_id).toBeNull();
  });

  it.each(["rate", "remove", "reassign"] as const)(
    "rolls past a changed first member when the sampled movie stays eligible: %s",
    async (change) => {
      await seed();
      let expectedId: string;
      const response = await duringSelection("/roll", async (sampledId) => {
        const otherIds = movieIds.filter((id) => id !== sampledId);
        expect((await reorder([...otherIds, sampledId!])).status).toBe(200);
        if (change === "rate") await rate(otherIds[0]);
        if (change === "remove") await remove(otherIds[0]);
        if (change === "reassign") await move(otherIds[0]);
        expectedId = otherIds[1];
      });
      expect(response.status).toBe(200);
      expect((await state())?.movie_id).toBe(expectedId!);
    },
  );

  it("continues using the order saved while continuation was deferred", async () => {
    await seed();
    await select(movieIds[0]);
    await rate(movieIds[0]);
    const response = await duringSelection("/next", async () => {
      expect((await reorder()).status).toBe(200);
      expect((await state())?.movie_id).toBe(movieIds[0]);
    });
    expect(response.status).toBe(200);
    expect((await state())?.movie_id).toBe(movieIds[2]);
  });

  it.each(["rate", "remove", "reassign"] as const)(
    "continues past a next member changed before commit: %s",
    async (change) => {
      await seed();
      await select(movieIds[0]);
      await rate(movieIds[0]);
      const response = await duringSelection("/next", async () => {
        if (change === "rate") await rate(movieIds[1]);
        if (change === "remove") await remove(movieIds[1]);
        if (change === "reassign") await move(movieIds[1]);
      });
      expect(response.status).toBe(200);
      expect((await state())?.movie_id).toBe(movieIds[2]);
    },
  );

  it("does not clear the watched selection when the last next member is rated", async () => {
    await seed(true, movieIds.slice(0, 2));
    await select(movieIds[0]);
    await rate(movieIds[0]);
    const before = await state();
    const response = await duringSelection("/next", async () => {
      await rate(movieIds[1]);
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Now Showing changed before it could advance",
    });
    expect(await state()).toEqual(before);
    const complete = await request("/next");
    expect(complete.status).toBe(409);
    expect(await complete.json()).toEqual({
      error: "This collection is complete",
      complete: true,
    });
  });

  it.each(["remove", "reassign"] as const)(
    "rejects continuation when the watched source changes collection: %s",
    async (change) => {
      await seed();
      await select(movieIds[0]);
      await rate(movieIds[0]);
      let afterChange: Awaited<ReturnType<typeof state>>;
      const response = await duringSelection("/next", async () => {
        if (change === "remove") {
          const removed = await request(
            `/movies/${movieIds[0]}`,
            { collectionName: "" },
            "PATCH",
          );
          expect(removed.status).toBe(200);
        }
        if (change === "reassign") await move(movieIds[0]);
        afterChange = await state();
      });
      expect(response.status).toBe(409);
      expect(await state()).toEqual(afterChange!);
    },
  );

  it.each(["/roll", "/next"] as const)(
    "preserves a competing selection committed before a deferred %s",
    async (path) => {
      await seed();
      if (path === "/next") {
        await select(movieIds[0]);
        await rate(movieIds[0]);
      }
      let committed: Awaited<ReturnType<typeof state>>;
      const response = await duringSelection(path, async () => {
        const first = await request(path);
        expect(first.status).toBe(200);
        committed = await state();
      });
      expect(response.status).toBe(409);
      expect(await state()).toEqual(committed!);
    },
  );
});

describe("collection reorder commits against current members and ratings", () => {
  it("preserves supported identifiers through the JSON-bound order", async () => {
    await seed();
    await env.DB.prepare("DELETE FROM movies").run();
    const ids = ["a".repeat(200), '名\\"前', "prefix\0suffix"];
    await env.DB.batch(
      ids.flatMap((id, index) => [
        env.DB.prepare(
          "INSERT INTO movies (id, title, added_at, updated_at) VALUES (?, 'Chapter', ?, ?)",
        ).bind(id, timestamp, timestamp),
        env.DB.prepare(
          "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
        ).bind(collectionId, id, index + 1),
      ]),
    );
    await select(ids[0]);
    expect((await reorder([...ids].reverse())).status).toBe(200);
    expect((await state())?.movie_id).toBe(ids[2]);
    expect(
      (
        await env.DB.prepare(
          "SELECT movie_id, position FROM collection_movies WHERE collection_id = ? ORDER BY position",
        )
          .bind(collectionId)
          .all()
      ).results,
    ).toEqual(
      [...ids]
        .reverse()
        .map((movie_id, index) => ({ movie_id, position: index + 1 })),
    );
  });

  it.each(["next member", "current member"] as const)(
    "honors a rating saved after reading members: %s",
    async (rated) => {
      await seed();
      await select(movieIds[0]);
      const deferred = deferredWrite("order");
      const pending = reorder([...movieIds].reverse(), deferred.DB);
      await deferred.ready;
      try {
        await rate(rated === "next member" ? movieIds[2] : movieIds[0]);
      } finally {
        deferred.release();
      }
      expect((await pending).status).toBe(200);
      expect((await state())?.movie_id).toBe(
        rated === "next member" ? movieIds[1] : movieIds[0],
      );
    },
  );

  it.each(["remove", "reassign", "append", "replace"] as const)(
    "rejects an outdated member set without partial ordering: %s",
    async (change) => {
      await seed();
      await select(movieIds[0]);
      const deferred = deferredWrite("order");
      const pending = reorder([...movieIds].reverse(), deferred.DB);
      await deferred.ready;
      let afterChange: Awaited<ReturnType<typeof state>>;
      let members: D1Result;
      let collection: unknown;
      const getMembers = () =>
        env.DB.prepare(
          "SELECT movie_id, position FROM collection_movies WHERE collection_id = ? ORDER BY position",
        )
          .bind(collectionId)
          .all();
      const getCollection = () =>
        env.DB.prepare("SELECT * FROM collections WHERE id = ?")
          .bind(collectionId)
          .first();
      try {
        if (change === "remove" || change === "replace")
          await remove(movieIds[2]);
        if (change === "reassign") await move(movieIds[2]);
        if (change === "append" || change === "replace") {
          const response = await request("/movies", {
            title: "New chapter",
            collectionName: "Rotation collection",
          });
          expect(response.status).toBe(201);
        }
        afterChange = await state();
        members = await getMembers();
        collection = await getCollection();
      } finally {
        deferred.release();
      }
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "The collection changed before its order could be saved",
      });
      expect(await state()).toEqual(afterChange!);
      expect((await getMembers()).results).toEqual(members!.results);
      expect(await getCollection()).toEqual(collection);
    },
  );

  it("lets two valid orders commit in sequence with the later order controlling selection", async () => {
    await seed();
    await select(movieIds[0]);
    const deferred = deferredWrite("order");
    const pending = reorder([...movieIds].reverse(), deferred.DB);
    await deferred.ready;
    try {
      expect(
        (await reorder([movieIds[1], movieIds[0], movieIds[2]])).status,
      ).toBe(200);
    } finally {
      deferred.release();
    }
    expect((await pending).status).toBe(200);
    expect((await state())?.movie_id).toBe(movieIds[2]);
  });

  it("supports large orders with bounded statements and linear local D1 row work", async () => {
    const ids = Array.from(
      { length: 600 },
      (_, index) => `chapter-${String(index).padStart(4, "0")}`,
    );
    await seed(true, ids);
    await select(ids[0]);
    const measurements: Array<{
      read: number;
      written: number;
      statements: number;
    }> = [];
    const DB = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            measurements.push({
              read: results.reduce(
                (total, result) => total + result.meta.rows_read,
                0,
              ),
              written: results.reduce(
                (total, result) => total + result.meta.rows_written,
                0,
              ),
              statements: statements.length,
            });
            return results;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect((await reorder([...ids].reverse(), DB)).status).toBe(200);
    expect((await state())?.movie_id).toBe(ids.at(-1));
    expect(
      (
        await env.DB.prepare(
          "SELECT movie_id, position FROM collection_movies WHERE collection_id = ? ORDER BY position",
        )
          .bind(collectionId)
          .all()
      ).results,
    ).toEqual(
      [...ids]
        .reverse()
        .map((movie_id, index) => ({ movie_id, position: index + 1 })),
    );
    await select(ids[0]);
    await env.DB.prepare(
      "DELETE FROM movies WHERE id IN (SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify(ids.slice(300)))
      .run();
    expect((await reorder(ids.slice(0, 300), DB)).status).toBe(200);
    expect(measurements).toHaveLength(2);
    expect(measurements[0].statements).toBe(4);
    expect(measurements[1].statements).toBe(4);
    expect(measurements[0].read).toBeLessThan(measurements[1].read * 2.2);
    expect(measurements[0].written).toBeLessThan(measurements[1].written * 2.2);
  });
});
