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
const patch = (body: unknown, options = bindings()) =>
  app.fetch(
    new Request("https://ludovico-tech.test/api/movies/movie", {
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
    title: id === 1 ? "Original" : "Reassociated",
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
    belongs_to_collection: data.collection,
    poster_path: data.posterPath,
    release_date: "",
    credits: {
      cast: data.cast.map((person, order) => ({ ...person, order })),
      crew: [],
    },
  });
};
const seed = async (linked: boolean) => {
  await env.DB.prepare(
    "INSERT INTO movies (id, title, imdb_id, added_at) VALUES ('movie', 'Original', 'tt1000000', ?)",
  )
    .bind(timestamp)
    .run();
  if (linked) {
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "movie", snapshot(1)),
    );
    await env.DB.prepare(
      `UPDATE movies SET version = 'Original cut', version_runtime = 130,
       version_reference_url = 'https://example.test/original' WHERE id = 'movie'`,
    ).run();
  }
};
const saved = () =>
  env.DB.prepare(
    `SELECT movies.title, imdb_id, version, version_runtime, version_reference_url,
          tmdb_id, collections.name AS collection_name
   FROM movies
   LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
   LEFT JOIN collection_movies ON collection_movies.movie_id = movies.id
   LEFT JOIN collections ON collections.id = collection_movies.collection_id
   WHERE movies.id = 'movie'`,
  ).first();
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const pauseNextBatch = () => {
  const entered = deferred<void>();
  const released = deferred<void>();
  let paused = false;
  return {
    entered: entered.promise,
    release: () => released.resolve(),
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
const pauseProvider = () => {
  const entered = deferred<void>();
  const result = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      entered.resolve();
      return result.promise;
    }),
  );
  return { entered: entered.promise, resolve: result.resolve };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("partial movie edits", () => {
  it.each([
    {
      name: "IMDb-only edit preserves a newer title",
      linked: false,
      first: { imdbId: "tt1000001" },
      second: { title: "New title" },
      expected: { title: "New title", imdb_id: "tt1000001" },
    },
    {
      name: "title-only edit preserves a newer IMDb ID",
      linked: false,
      first: { title: "Requested title" },
      second: { imdbId: "tt1000002" },
      expected: { title: "Requested title", imdb_id: "tt1000002" },
    },
    {
      name: "explicit IMDb clearing preserves a newer title",
      linked: false,
      first: { imdbId: null },
      second: { title: "New title" },
      expected: { title: "New title", imdb_id: null },
    },
    {
      name: "IMDb-only edit preserves newer version and membership fields",
      linked: true,
      first: { imdbId: "tt1000001" },
      second: {
        version: "New cut",
        versionRuntime: 150,
        versionReferenceUrl: "https://example.test/new",
        collectionName: "New collection",
      },
      expected: {
        imdb_id: "tt1000001",
        version: "New cut",
        version_runtime: 150,
        version_reference_url: "https://example.test/new",
        collection_name: "New collection",
      },
    },
    {
      name: "runtime-only edit preserves a newer version and reference URL",
      linked: true,
      first: { versionRuntime: 140 },
      second: {
        version: "New cut",
        versionReferenceUrl: "https://example.test/new",
      },
      expected: {
        version: "New cut",
        version_runtime: 140,
        version_reference_url: "https://example.test/new",
      },
    },
    {
      name: "explicit version clearing preserves a newer IMDb ID",
      linked: true,
      first: { version: null },
      second: { imdbId: "tt1000002" },
      expected: {
        imdb_id: "tt1000002",
        version: null,
        version_runtime: null,
        version_reference_url: null,
      },
    },
    {
      name: "explicit detail clearing preserves a newer version label",
      linked: true,
      first: { versionRuntime: null, versionReferenceUrl: null },
      second: { version: "New cut" },
      expected: {
        version: "New cut",
        version_runtime: null,
        version_reference_url: null,
      },
    },
    {
      name: "last committed explicit IMDb value wins without reverting an unrelated title",
      linked: false,
      first: { imdbId: "tt1000001" },
      second: { imdbId: "tt1000002", title: "New title" },
      expected: { title: "New title", imdb_id: "tt1000001" },
    },
  ])("$name", async ({ linked, first, second, expected }) => {
    await seed(linked);
    const barrier = pauseNextBatch();
    const pending = patch(first, barrier.bindings);
    await barrier.entered;
    expect((await patch(second)).status).toBe(200);
    barrier.release();

    expect((await pending).status).toBe(200);
    expect(await saved()).toMatchObject(expected);
  });

  it("preserves newer IMDb and membership fields during a delayed reassociation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    await seed(true);
    const provider = pauseProvider();
    const pending = patch({ tmdbId: 2 });
    await provider.entered;
    expect(
      (
        await patch({
          imdbId: "tt1000002",
          version: "Another A cut",
          collectionName: "New collection",
        })
      ).status,
    ).toBe(200);
    provider.resolve(providerResponse(2));

    expect((await pending).status).toBe(200);
    expect(await saved()).toMatchObject({
      title: "Reassociated",
      tmdb_id: 2,
      imdb_id: "tt1000002",
      collection_name: "New collection",
      version: null,
      version_runtime: null,
      version_reference_url: null,
    });
  });

  it("preserves newer version fields during a delayed same-identity confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    await seed(true);
    const provider = pauseProvider();
    const pending = patch({ tmdbId: 1 });
    await provider.entered;
    expect(
      (
        await patch({
          version: "New cut",
          versionRuntime: 150,
          versionReferenceUrl: "https://example.test/new",
        })
      ).status,
    ).toBe(200);
    provider.resolve(providerResponse(1));

    expect((await pending).status).toBe(200);
    expect(await saved()).toMatchObject({
      tmdb_id: 1,
      version: "New cut",
      version_runtime: 150,
      version_reference_url: "https://example.test/new",
    });
  });

  it("does not restore omitted version fields if a pending explicit link follows an unlink", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    await seed(true);
    const provider = pauseProvider();
    const pending = patch({ tmdbId: 1 });
    await provider.entered;
    expect((await patch({ tmdbId: null })).status).toBe(200);
    provider.resolve(providerResponse(1));

    expect((await pending).status).toBe(200);
    expect(await saved()).toMatchObject({
      tmdb_id: 1,
      version: null,
      version_runtime: null,
      version_reference_url: null,
    });
  });

  it("preserves the current version when another edit already selected the requested identity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    await seed(true);
    const entered = deferred<void>();
    const result = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => {
          entered.resolve();
          return result.promise;
        })
        .mockResolvedValueOnce(providerResponse(2)),
    );
    const pending = patch({ tmdbId: 2 });
    await entered.promise;
    expect(
      (
        await patch({
          tmdbId: 2,
          version: "Current B cut",
          versionRuntime: 160,
        })
      ).status,
    ).toBe(200);
    result.resolve(providerResponse(2));

    expect((await pending).status).toBe(200);
    expect(await saved()).toMatchObject({
      tmdb_id: 2,
      version: "Current B cut",
      version_runtime: 160,
    });
  });

  it.each([
    {
      first: { version: "Requested cut" },
      second: { tmdbId: null },
      name: "unlink",
    },
    {
      first: { versionRuntime: 140 },
      second: { version: null },
      name: "version removal before runtime edit",
    },
    {
      first: { versionReferenceUrl: "https://example.test/new" },
      second: { version: null },
      name: "version removal before reference edit",
    },
  ])(
    "rolls back an edit whose required version state changed: $name",
    async ({ first, second }) => {
      await seed(true);
      const barrier = pauseNextBatch();
      const pending = patch(
        { ...first, imdbId: "tt1000001", collectionName: "Must roll back" },
        barrier.bindings,
      );
      await barrier.entered;
      expect((await patch(second)).status).toBe(200);
      const current = await saved();
      barrier.release();
      const response = await pending;

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error:
          "The movie's TMDB match or version changed. Reload and try again.",
      });
      expect(await saved()).toEqual(current);
      expect(
        await env.DB.prepare(
          "SELECT id FROM collections WHERE name = 'Must roll back'",
        ).first(),
      ).toBeNull();
    },
  );
});
