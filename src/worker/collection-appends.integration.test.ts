import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "./env";
import { createApp } from "./index";

const app = createApp();
const request = (
  path: string,
  body: unknown,
  method = "POST",
  bindings: AppEnv["Bindings"] = env,
) =>
  app.fetch(
    new Request(`https://ludovico-tech.test/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    bindings,
  );

const addMovie = async (title: string, collectionName = "") => {
  const response = await request("/movies", { title, collectionName });
  expect(response.status).toBe(201);
  return (
    await response.json<{ movie: { id: string; collection_id: string } }>()
  ).movie;
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const pauseNextBatch = () => {
  const entered = deferred();
  const released = deferred();
  let paused = false;
  return {
    entered: entered.promise,
    release: released.resolve,
    bindings: {
      ...env,
      DB: {
        prepare: (query: string) => env.DB.prepare(query),
        batch: async (statements: D1PreparedStatement[]) => {
          if (!paused) {
            paused = true;
            entered.resolve();
            await released.promise;
          }
          return env.DB.batch(statements);
        },
      } as D1Database,
    } as AppEnv["Bindings"],
  };
};

describe("atomic collection appends", () => {
  it("repairs Now Showing using the collection created by a concurrent append", async () => {
    const moving = await addMovie("Moving selection", "Source");
    await env.DB.prepare(
      "UPDATE now_showing SET movie_id = ?, rolled_at = ? WHERE id = 1",
    )
      .bind(moving.id, "2026-09-14T00:00:00.000Z")
      .run();
    const barrier = pauseNextBatch();
    const pending = request(
      `/movies/${moving.id}`,
      { collectionName: "Target" },
      "PATCH",
      barrier.bindings,
    );
    await barrier.entered;
    const target = await addMovie("First target movie", "Target");
    await env.DB.prepare(
      "UPDATE collections SET order_confirmed = 1 WHERE id = ?",
    )
      .bind(target.collection_id)
      .run();
    barrier.release();

    expect((await pending).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT movie_id FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({ movie_id: target.id });
  });

  for (const existingCollection of [false, true]) {
    it.each([
      ["add", "add"],
      ["move", "move"],
      ["add", "move"],
    ] as const)(
      `preserves concurrent %s/%s contributions with existing collection=${existingCollection}`,
      async (firstOperation, secondOperation) => {
        const target = existingCollection
          ? await addMovie("Target anchor", "Target")
          : null;
        if (target) {
          await env.DB.prepare(
            "UPDATE collections SET order_confirmed = 1 WHERE id = ?",
          )
            .bind(target.collection_id)
            .run();
        }
        await addMovie("Source anchor", "Source");
        const firstMovie =
          firstOperation === "move"
            ? await addMovie("First contribution", "Source")
            : null;
        const secondMovie =
          secondOperation === "move"
            ? await addMovie("Second contribution", "Source")
            : null;
        const barrier = pauseNextBatch();
        const pending = firstMovie
          ? request(
              `/movies/${firstMovie.id}`,
              { collectionName: "Target" },
              "PATCH",
              barrier.bindings,
            )
          : request(
              "/movies",
              { title: "First contribution", collectionName: "Target" },
              "POST",
              barrier.bindings,
            );
        await barrier.entered;
        const second = secondMovie
          ? await request(
              `/movies/${secondMovie.id}`,
              { collectionName: "target" },
              "PATCH",
            )
          : await request("/movies", {
              title: "Second contribution",
              collectionName: "target",
            });
        barrier.release();
        const first = await pending;

        expect(first.status).toBe(firstMovie ? 200 : 201);
        expect(second.status).toBe(secondMovie ? 200 : 201);
        const collections = await env.DB.prepare(
          "SELECT id, name, order_confirmed, created_by, updated_by FROM collections WHERE name_normalized = 'target'",
        ).all<{
          id: string;
          name: string;
          order_confirmed: number;
          created_by: string;
          updated_by: string;
        }>();
        expect(collections.results).toHaveLength(1);
        const collection = collections.results[0];
        expect(collection).toMatchObject({
          ...(target ? { id: target.collection_id } : {}),
          name: target ? "Target" : "target",
          order_confirmed: target ? 1 : 0,
          created_by: expect.any(String),
          updated_by: expect.any(String),
        });
        const members = await env.DB.prepare(
          `SELECT movies.title, collection_movies.position
           FROM collection_movies JOIN movies ON movies.id = collection_movies.movie_id
           WHERE collection_id = ? ORDER BY position`,
        )
          .bind(collection.id)
          .all();
        expect(members.results).toEqual([
          ...(target ? [{ title: "Target anchor", position: 1 }] : []),
          { title: "Second contribution", position: target ? 2 : 1 },
          { title: "First contribution", position: target ? 3 : 2 },
        ]);
        expect(
          (
            await env.DB.prepare(
              `SELECT movies.title FROM collection_movies
           JOIN movies ON movies.id = collection_movies.movie_id
           JOIN collections ON collections.id = collection_movies.collection_id
           WHERE collections.name_normalized = 'source'`,
            ).all()
          ).results,
        ).toEqual([{ title: "Source anchor" }]);
      },
    );
  }
});
