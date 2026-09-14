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
const request = (body: unknown, options = bindings(), method = "PATCH") =>
  app.fetch(
    new Request("https://ludovico-tech.test/api/movies/movie", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    options,
  );
const snapshot = (id: number): TmdbMovieResult => ({
  fetchedAt: timestamp,
  data: {
    id,
    title: id === 1 ? "Original" : "New provider title",
    cast: [{ id: id * 10, name: "Actor" }],
    directors: [],
    collection: null,
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
    belongs_to_collection: null,
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
    env.DB
      .prepare(`INSERT INTO collections (id, name, name_normalized, created_at, updated_at, order_confirmed)
      VALUES ('source', 'Source', 'source', '2026-01-01', '2026-01-01', 1),
             ('target', 'Target', 'target', '2026-01-01', '2026-01-01', 1)`),
    env.DB.prepare(`INSERT INTO movies (id, title, added_at) VALUES
      ('anchor', 'Earlier source movie', '2025-01-01'),
      ('movie', 'Original', '2026-01-01'),
      ('target-anchor', 'Target movie', '2026-01-01')`),
    env.DB
      .prepare(`INSERT INTO collection_movies (collection_id, movie_id, position)
      VALUES ('source', 'anchor', 1), ('source', 'movie', 2), ('target', 'target-anchor', 1)`),
    env.DB.prepare(
      "UPDATE now_showing SET movie_id = 'movie', rolled_at = '2026-01-01' WHERE id = 1",
    ),
  ]);
  if (linked)
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "movie", snapshot(1)),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) =>
      Promise.resolve(
        providerResponse(Number(new URL(input).pathname.split("/").at(-1))),
      ),
    ),
  );
};
const saved = async () => {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT * FROM movies ORDER BY id"),
    env.DB.prepare("SELECT * FROM movie_tmdb_data ORDER BY movie_id"),
    env.DB.prepare(
      "SELECT * FROM movie_credits ORDER BY movie_id, credit_type, position",
    ),
    env.DB.prepare("SELECT * FROM tmdb_people ORDER BY tmdb_id"),
    env.DB.prepare("SELECT * FROM collections ORDER BY id"),
    env.DB.prepare(
      "SELECT * FROM collection_movies ORDER BY collection_id, position",
    ),
    env.DB.prepare("SELECT * FROM now_showing"),
  ]);
  return results.map((result) => result.results);
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("current title confirmation", () => {
  it.each([undefined, null, "New target", "Target"])(
    "rejects every side effect after a concurrent link with collectionName=%s",
    async (collectionName) => {
      await seed();
      const barrier = pauseNextBatch();
      const pending = request(
        {
          title: "Manual title",
          imdbId: "tt1000001",
          version: null,
          ...(collectionName === undefined ? {} : { collectionName }),
        },
        barrier.bindings,
      );
      await barrier.entered;
      vi.setSystemTime(new Date(timestamp).getTime() + 1000);
      expect(
        (await request({ tmdbId: 1, version: "New cut", versionRuntime: 150 }))
          .status,
      ).toBe(200);
      const current = await saved();
      barrier.release();
      const response = await pending;

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error:
          "The movie's TMDB match changed. Reload and confirm or remove the match before changing the title.",
      });
      expect(await saved()).toEqual(current);
    },
  );

  it("rechecks an initially unchanged linked title after a reassociation", async () => {
    await seed(true);
    const barrier = pauseNextBatch();
    const pending = request(
      { title: "Original", collectionName: "Target" },
      barrier.bindings,
    );
    await barrier.entered;
    expect((await request({ tmdbId: 2 })).status).toBe(200);
    const current = await saved();
    barrier.release();

    expect((await pending).status).toBe(409);
    expect(await saved()).toEqual(current);
  });

  it("preserves an unlinked movie's disjoint edits and applies its complete requested move", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request(
      { title: "Manual title", collectionName: "Target" },
      barrier.bindings,
    );
    await barrier.entered;
    expect((await request({ imdbId: "tt1000002" })).status).toBe(200);
    barrier.release();

    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: {
        title: "Manual title",
        imdb_id: "tt1000002",
        collection_id: "target",
        collection_position: 2,
      },
    });
    expect(
      await env.DB.prepare("SELECT movie_id FROM now_showing").first(),
    ).toEqual({ movie_id: "target-anchor" });
  });

  it("allows the existing unchanged-title exception on a linked movie", async () => {
    await seed(true);
    const response = await request({
      title: "Original",
      imdbId: "tt1000002",
      collectionName: "Target",
      version: "Requested cut",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: {
        title: "Original",
        imdb_id: "tt1000002",
        tmdb_id: 1,
        collection_id: "target",
        version: "Requested cut",
      },
    });
  });

  it("allows a manual title if a concurrent link was subsequently removed", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request(
      { title: "Manual title", collectionName: "Target" },
      barrier.bindings,
    );
    await barrier.entered;
    expect((await request({ tmdbId: 1 })).status).toBe(200);
    expect((await request({ tmdbId: null })).status).toBe(200);
    barrier.release();

    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      movie: { title: "Manual title", tmdb_id: null, collection_id: "target" },
    });
  });

  it("does not create a destination for a concurrently deleted movie", async () => {
    await seed();
    const barrier = pauseNextBatch();
    const pending = request(
      { title: "Manual title", collectionName: "New target" },
      barrier.bindings,
    );
    await barrier.entered;
    expect((await request(undefined, bindings(), "DELETE")).status).toBe(200);
    const current = await saved();
    barrier.release();

    expect((await pending).status).toBe(409);
    expect(await saved()).toEqual(current);
  });

  it("keeps sequential title validation and explicit confirmation or unlink behavior", async () => {
    await seed(true);
    expect(
      (await request({ title: "Manual title", collectionName: "Target" }))
        .status,
    ).toBe(400);
    const confirmed = await request({
      title: "Manual title",
      tmdbId: 2,
      collectionName: "Target",
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      movie: {
        title: "New provider title",
        tmdb_id: 2,
        collection_id: "target",
      },
    });
    const unlinked = await request({
      title: "Manual title",
      tmdbId: null,
      collectionName: "Source",
    });
    expect(unlinked.status).toBe(200);
    expect(await unlinked.json()).toMatchObject({
      movie: { title: "Manual title", tmdb_id: null, collection_id: "source" },
    });
  });
});
