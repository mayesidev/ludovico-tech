import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./env";
import { createApp } from "./index";
import { replaceTmdbDataStatements } from "./tmdb-data";
import type { TmdbMovieResult } from "./tmdb";

const app = createApp();
const timestamp = "2026-09-14T00:00:00.000Z";
const bindings = () =>
  ({ ...env, TMDB_READ_ACCESS_TOKEN: "test-token" }) as AppEnv["Bindings"];
const request = (body: unknown, options = bindings(), movieId = "movie") =>
  app.fetch(
    new Request(`https://ludovico-tech.test/api/movies/${movieId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    options,
  );
const snapshot = (id: number): TmdbMovieResult => ({
  fetchedAt: timestamp,
  data: {
    id,
    title: id === 1 ? "Original" : "Provider title",
    cast: [{ id: id * 10, name: `Actor ${id}` }],
    directors: [],
    collection: { id: id * 100, name: `Provider collection ${id}` },
    posterPath: null,
    releaseDate: null,
    runtimeMinutes: 120,
  },
});
const providerResponse = (id: number) => {
  const { data } = snapshot(id);
  return Response.json({
    id,
    title: data.title,
    runtime: data.runtimeMinutes,
    belongs_to_collection: data.collection,
    poster_path: null,
    release_date: "",
    credits: {
      cast: data.cast.map((person, order) => ({ ...person, order })),
      crew: [],
    },
  });
};
const seed = async (linked = false) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(timestamp);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO collections
      (id, name, name_key, created_at, updated_at, order_confirmed)
      VALUES ('source', 'Source', 'source', '2026-01-01', '2026-01-01', 1),
             ('target', 'Target', 'target', '2026-01-01', '2026-01-01', 1)`),
    env.DB.prepare(`INSERT INTO movies (id, title, added_at) VALUES
      ('movie', 'Original', '2026-01-01'),
      ('source-anchor', 'Source anchor', '2025-01-01'),
      ('target-anchor', 'Target anchor', '2025-01-01')`),
    env.DB
      .prepare(`INSERT INTO collection_memberships (collection_id, movie_id, position)
      VALUES ('source', 'source-anchor', 1), ('source', 'movie', 2),
             ('target', 'target-anchor', 1)`),
    env.DB.prepare(
      "UPDATE now_showing SET movie_id = 'movie', rolled_at = '2026-01-01' WHERE id = 1",
    ),
  ]);
  if (linked) {
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "movie", snapshot(1)),
    );
    await env.DB.prepare(
      "UPDATE movies SET version = 'Old cut', version_runtime = 140 WHERE id = 'movie'",
    ).run();
  }
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) =>
      Promise.resolve(
        providerResponse(Number(new URL(input).pathname.split("/").at(-1))),
      ),
    ),
  );
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
      ...bindings(),
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
const grouping = async () => {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT * FROM collections ORDER BY id"),
    env.DB.prepare(
      "SELECT * FROM collection_memberships ORDER BY collection_id, position",
    ),
    env.DB.prepare("SELECT * FROM now_showing"),
  ]);
  return results.map((result) => result.results);
};
const catalog = async () => {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT * FROM movies ORDER BY id"),
    env.DB.prepare("SELECT * FROM movie_tmdb_data ORDER BY movie_id"),
    env.DB.prepare(
      "SELECT * FROM movie_credits ORDER BY movie_id, credit_type, position",
    ),
    env.DB.prepare("SELECT * FROM tmdb_people ORDER BY tmdb_id"),
    env.DB.prepare("SELECT * FROM tmdb_collections ORDER BY tmdb_id"),
  ]);
  return [...results.map((result) => result.results), ...(await grouping())];
};
const selectedMovie = () =>
  env.DB.prepare("SELECT movie_id FROM now_showing").first();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("explicit collection destinations", () => {
  it.each(["Target", null])(
    "applies an initially identical destination after a concurrent move to %s",
    async (concurrentDestination) => {
      await seed();
      const barrier = pauseNextBatch();
      const pending = request(
        { title: "Requested title", collectionName: " SOURCE " },
        barrier.bindings,
      );
      await barrier.entered;
      expect(
        (
          await request({
            collectionName: concurrentDestination,
            imdbId: "tt1000001",
          })
        ).status,
      ).toBe(200);
      barrier.release();

      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        movie: {
          title: "Requested title",
          imdb_id: "tt1000001",
          collection_id: "source",
          collection_name: "Source",
          collection_position: 2,
        },
      });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM collection_memberships WHERE movie_id = 'movie'",
        ).first(),
      ).toEqual({ count: 1 });
    },
  );

  it.each([false, true])(
    "moves from the actual competing source and preserves another member=%s",
    async (otherMember) => {
      await seed();
      const barrier = pauseNextBatch();
      const pending = request({ collectionName: "Target" }, barrier.bindings);
      await barrier.entered;
      vi.setSystemTime(new Date(timestamp).getTime() + 1000);
      expect((await request({ collectionName: "Other" })).status).toBe(200);
      if (otherMember)
        expect(
          (
            await request(
              { collectionName: "Other" },
              bindings(),
              "source-anchor",
            )
          ).status,
        ).toBe(200);
      const previousSource = await env.DB.prepare(
        "SELECT * FROM collections WHERE id = 'source'",
      ).first();
      barrier.release();

      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        movie: { collection_id: "target", collection_position: 2 },
      });
      const other = await env.DB.prepare(
        "SELECT updated_at, updated_by FROM collections WHERE name_key = 'other'",
      ).first();
      if (otherMember)
        expect(other).toMatchObject({
          updated_at: timestamp,
          updated_by: expect.any(String),
        });
      else expect(other).toBeNull();
      expect(
        await env.DB.prepare(
          "SELECT * FROM collections WHERE id = 'source'",
        ).first(),
      ).toEqual(previousSource);
      expect(await selectedMovie()).toEqual({ movie_id: "target-anchor" });
    },
  );

  it("preserves an already-satisfied destination's position, attribution, and later selected member", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request(
      { collectionName: "Target", imdbId: "tt1000002" },
      barrier.bindings,
    );
    await barrier.entered;
    vi.setSystemTime(new Date(timestamp).getTime() + 1000);
    expect((await request({ collectionName: "Target" })).status).toBe(200);
    await env.DB.prepare(
      "UPDATE now_showing SET movie_id = 'movie', rolled_at = '2026-09-14T00:00:02.000Z' WHERE id = 1",
    ).run();
    const before = await grouping();
    barrier.release();

    expect((await pending).status).toBe(200);
    expect(await grouping()).toEqual(before);
    expect(
      await env.DB.prepare(
        "SELECT imdb_id FROM movies WHERE id = 'movie'",
      ).first(),
    ).toEqual({ imdb_id: "tt1000002" });
  });

  it("appends to the actual destination created while the request is pending", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request({ collectionName: "New target" }, barrier.bindings);
    await barrier.entered;
    expect(
      (
        await request(
          { collectionName: "New target" },
          bindings(),
          "target-anchor",
        )
      ).status,
    ).toBe(200);
    const target = await env.DB.prepare(
      "SELECT id, name, created_at, created_by FROM collections WHERE name_key = 'new target'",
    ).first();
    barrier.release();

    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: { collection_id: target?.id, collection_position: 2 },
    });
    expect(
      await env.DB.prepare(
        "SELECT id, name, created_at, created_by FROM collections WHERE name_key = 'new target'",
      ).first(),
    ).toEqual(target);
    expect(await selectedMovie()).toEqual({ movie_id: "target-anchor" });
  });

  it.each([false, true])(
    "unlinks the current source including sole-source cascade=%s",
    async (soleSource) => {
      await seed();
      expect((await request({ collectionName: null })).status).toBe(200);
      const barrier = pauseNextBatch();
      const pending = request(
        { collectionName: null, title: "Standalone" },
        barrier.bindings,
      );
      await barrier.entered;
      expect(
        (
          await request({
            collectionName: soleSource ? "Only movie" : "Source",
          })
        ).status,
      ).toBe(200);
      await env.DB.prepare(
        "UPDATE now_showing SET movie_id = 'movie' WHERE id = 1",
      ).run();
      barrier.release();

      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        movie: {
          title: "Standalone",
          collection_id: null,
          collection_position: null,
        },
      });
      expect(await selectedMovie()).toEqual({ movie_id: "movie" });
      expect(
        await env.DB.prepare(
          "SELECT id FROM collections WHERE name_key = 'only movie'",
        ).first(),
      ).toBeNull();
      expect(
        await env.DB.prepare(
          "SELECT movie_id FROM collection_memberships WHERE collection_id = 'source'",
        ).all(),
      ).toMatchObject({ results: [{ movie_id: "source-anchor" }] });
    },
  );

  it("preserves a concurrent membership when the field is omitted", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request({ title: "Requested title" }, barrier.bindings);
    await barrier.entered;
    expect((await request({ collectionName: "Target" })).status).toBe(200);
    const current = await grouping();
    barrier.release();
    expect((await pending).status).toBe(200);
    expect(await grouping()).toEqual(current);
  });

  it("applies a complete explicit metadata edit after a move during the provider request", async () => {
    await seed(true);
    const entered = deferred();
    const released = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        entered.resolve();
        await released.promise;
        return providerResponse(2);
      }),
    );
    const pending = request({
      title: "Ignored manual title",
      tmdbId: 2,
      collectionName: "Source",
      imdbId: "tt1000002",
      version: "Requested cut",
      versionRuntime: 155,
      versionReferenceUrl: "https://example.com/cut",
    });
    await entered.promise;
    expect(
      (await request({ collectionName: "Target", imdbId: "tt1000003" })).status,
    ).toBe(200);
    released.resolve();

    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: {
        title: "Provider title",
        tmdb_id: 2,
        collection_id: "source",
        imdb_id: "tt1000002",
        version: "Requested cut",
        version_runtime: 155,
        version_reference_url: "https://example.com/cut",
      },
    });
    expect(
      (await env.DB.prepare("SELECT tmdb_id FROM tmdb_people").all()).results,
    ).toEqual([{ tmdb_id: 20 }]);
    expect(
      (await env.DB.prepare("SELECT tmdb_id FROM tmdb_collections").all())
        .results,
    ).toEqual([{ tmdb_id: 200 }]);
  });

  it("unlinks TMDB and clears dependent version fields while applying explicit collection intent", async () => {
    await seed(true);
    const barrier = pauseNextBatch();
    const pending = request(
      {
        tmdbId: null,
        title: "Manual title",
        collectionName: "Source",
        imdbId: "tt1000004",
      },
      barrier.bindings,
    );
    await barrier.entered;
    expect(
      (await request({ collectionName: "Target", version: "Concurrent cut" }))
        .status,
    ).toBe(200);
    barrier.release();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: {
        title: "Manual title",
        tmdb_id: null,
        version: null,
        version_runtime: null,
        imdb_id: "tt1000004",
        collection_id: "source",
      },
    });
  });

  it("skips every catalog side effect when a concurrent link invalidates a stale same-destination title edit", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request(
      {
        title: "Manual title",
        collectionName: "Source",
        imdbId: "tt1000004",
        version: null,
      },
      barrier.bindings,
    );
    await barrier.entered;
    expect(
      (
        await request({
          tmdbId: 1,
          collectionName: "Target",
          version: "New cut",
        })
      ).status,
    ).toBe(200);
    const current = await catalog();
    barrier.release();
    expect((await pending).status).toBe(409);
    expect(await catalog()).toEqual(current);
  });

  it.each([false, true])(
    "rolls back mixed metadata, attribution, and source cleanup on membership failure with sole source=%s",
    async (soleSource) => {
      await seed(true);
      if (soleSource)
        await env.DB.prepare(
          "DELETE FROM collection_memberships WHERE movie_id = 'source-anchor'",
        ).run();
      // Warm auth before the snapshot; user creation and provider cache are outside
      // the catalog mutation batch and are not part of its rollback contract.
      expect((await request({ imdbId: "tt1000001" })).status).toBe(200);
      const current = await catalog();
      await env.DB.prepare(
        `CREATE TRIGGER reject_membership BEFORE INSERT ON collection_memberships
      BEGIN SELECT RAISE(ABORT, 'membership failure'); END`,
      ).run();
      try {
        const response = await request({
          title: "Requested title",
          tmdbId: 2,
          collectionName: "New target",
          imdbId: "tt1000002",
          version: "Requested cut",
          versionRuntime: 155,
        });
        expect(response.status).toBe(500);
        expect(await catalog()).toEqual(current);
      } finally {
        await env.DB.prepare("DROP TRIGGER reject_membership").run();
      }
    },
  );
});
