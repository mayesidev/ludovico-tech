import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index";
import type { AppEnv } from "./env";
import {
  getTmdbMovieCacheKey,
  tmdbMovieCachePersistenceStatements,
  type TmdbMovieResult,
} from "./tmdb";
import { refreshDueTmdbData, replaceTmdbDataStatements } from "./tmdb-data";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";

const timestamp = "2026-09-13T12:00:00.000Z";
const yesterday = "2026-09-12T12:00:00.000Z";
const bindings = () =>
  ({ ...env, TMDB_READ_ACCESS_TOKEN: "test-token" }) as AppEnv["Bindings"];
const app = createApp();
const request = (method: string, body?: unknown) =>
  app.fetch(
    new Request("https://ludovico-tech.test/api/movies/member-movie", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    bindings(),
  );
const snapshot = (
  id: number,
  title: string,
  fetchedAt = yesterday,
): TmdbMovieResult => ({
  data: {
    id,
    title,
    cast: [{ id: id * 10, name: `${title} actor` }],
    directors: [{ id: id * 10 + 1, name: `${title} director` }],
    collection: { id: id * 100, name: `${title} collection` },
    posterPath: `/${id}.jpg`,
    releaseDate: "2020-01-01",
    runtimeMinutes: 120 + id,
  },
  fetchedAt,
});
const providerResponse = ({ data }: TmdbMovieResult) =>
  Response.json({
    id: data.id,
    title: data.title,
    belongs_to_collection: data.collection,
    poster_path: data.posterPath,
    release_date: data.releaseDate,
    runtime: data.runtimeMinutes,
    credits: {
      cast: data.cast.map((person, order) => ({ ...person, order })),
      crew: data.directors.map((person) => ({ ...person, job: "Director" })),
    },
  });
const cache = async (result: TmdbMovieResult) => {
  const cacheKey = await getTmdbMovieCacheKey(
    await getTmdbMetadataContractId(),
    result.data.id,
  );
  await env.DB.batch(
    tmdbMovieCachePersistenceStatements(
      env,
      [{ cacheKey, tmdbId: result.data.id, result }],
      [],
      timestamp,
    ),
  );
};
const seedMovie = async (movieId: string, result: TmdbMovieResult) => {
  await env.DB.prepare(
    "INSERT INTO movies (id, title, added_at) VALUES (?, ?, ?)",
  )
    .bind(movieId, result.data.title, yesterday)
    .run();
  await env.DB.batch(
    await replaceTmdbDataStatements(env, movieId, result, {
      updatedAt: timestamp,
    }),
  );
};
const savedState = async () => {
  const [movies, metadata, credits, people, collections] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM movies ORDER BY id"),
    env.DB.prepare("SELECT * FROM movie_tmdb_data ORDER BY movie_id"),
    env.DB.prepare(
      "SELECT * FROM movie_credits ORDER BY movie_id, credit_type, position",
    ),
    env.DB.prepare("SELECT * FROM tmdb_people ORDER BY tmdb_id"),
    env.DB.prepare("SELECT * FROM tmdb_collections ORDER BY tmdb_id"),
  ]);
  return {
    movies: movies.results,
    metadata: metadata.results,
    credits: credits.results,
    people: people.results,
    collections: collections.results,
  };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("member TMDB identity changes", () => {
  it.each([false, true])(
    "accepts an older cached reassociation with explicit version=%s and preserves fresher shared names",
    async (withVersion) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(timestamp);
      await seedMovie("member-movie", snapshot(1, "A", timestamp));
      await env.DB.prepare(
        "UPDATE movies SET version = 'Old cut', version_runtime = 150 WHERE id = 'member-movie'",
      ).run();
      const olderB = snapshot(2, "B");
      const shared = snapshot(3, "Other", timestamp);
      shared.data.cast = [{ id: 20, name: "Newest shared actor" }];
      shared.data.directors = [];
      shared.data.collection = { id: 200, name: "Newest shared collection" };
      await seedMovie("other-movie", shared);
      await cache(olderB);
      const fetchMock = vi.spyOn(globalThis, "fetch");

      const response = await request("PATCH", {
        tmdbId: 2,
        ...(withVersion ? { version: "New cut", versionRuntime: 140 } : {}),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        movie: {
          title: "B",
          tmdb_id: 2,
          poster_path: "/2.jpg",
          runtime_minutes: 122,
          version: withVersion ? "New cut" : null,
          version_runtime: withVersion ? 140 : null,
          cast: [{ tmdbId: 20, name: "Newest shared actor" }],
          directors: [{ tmdbId: 21, name: "B director" }],
        },
      });
      expect(
        await env.DB.prepare(
          "SELECT tmdb_id, title, fetched_at FROM movie_tmdb_data WHERE movie_id = 'member-movie'",
        ).first(),
      ).toEqual({ tmdb_id: 2, title: "B", fetched_at: yesterday });
      expect(
        await env.DB.prepare(
          "SELECT name FROM tmdb_collections WHERE tmdb_id = 200",
        ).first(),
      ).toEqual({ name: "Newest shared collection" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  for (const outcome of ["changed", "unchanged", "not found"] as const) {
    it.each([
      "unlink",
      "reassociate",
      "unlink and relink",
      "A to B to A",
      "delete",
    ])(
      `preserves %s when a pending refresh returns ${outcome}`,
      async (change) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(timestamp);
        const original = snapshot(1, "A");
        await seedMovie("member-movie", original);
        await env.DB.prepare(
          "UPDATE movie_tmdb_data SET refresh_after = '1970-01-01T00:00:00.000Z'",
        ).run();
        const started = deferred<void>();
        const pending = deferred<Response>();
        const fetchMock = vi.fn(() => {
          started.resolve();
          return pending.promise;
        });
        vi.stubGlobal("fetch", fetchMock);
        const refresh = refreshDueTmdbData(bindings(), timestamp);
        await started.promise;
        await cache(original);
        await cache(snapshot(2, "B"));
        if (change === "delete") {
          expect((await request("DELETE")).status).toBe(200);
        } else {
          const firstId = change.startsWith("unlink") ? null : 2;
          expect((await request("PATCH", { tmdbId: firstId })).status).toBe(
            200,
          );
          if (change === "unlink and relink" || change === "A to B to A") {
            expect((await request("PATCH", { tmdbId: 1 })).status).toBe(200);
          }
        }
        const memberState = await savedState();
        const result =
          outcome === "unchanged" ? original : snapshot(1, "Obsolete response");
        if (outcome === "changed") {
          result.data.cast = [{ id: 999, name: "Obsolete new actor" }];
          result.data.collection = { id: 999, name: "Obsolete new collection" };
        }
        pending.resolve(
          outcome === "not found"
            ? new Response(null, { status: 404 })
            : providerResponse(result),
        );

        await expect(refresh).resolves.toEqual({
          attempted: 1,
          failed: 0,
          rateLimited: false,
          refreshed: 0,
          skipped: 1,
        });
        expect(await savedState()).toEqual(memberState);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
    );
  }

  it("backfills legacy links with a null revision without a migration rewrite", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('legacy', 'Legacy', ?)",
      ).bind(yesterday),
      env.DB.prepare(
        "INSERT INTO movie_tmdb_data (movie_id, tmdb_id, refresh_after) VALUES ('legacy', 1, '1970-01-01T00:00:00.000Z')",
      ),
    ]);
    expect(
      await env.DB.prepare(
        "SELECT snapshot_revision FROM movie_tmdb_data WHERE movie_id = 'legacy'",
      ).first(),
    ).toEqual({ snapshot_revision: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(providerResponse(snapshot(1, "Backfilled"))),
    );

    await expect(
      refreshDueTmdbData(bindings(), timestamp),
    ).resolves.toMatchObject({ refreshed: 1, failed: 0 });
    expect(
      await env.DB.prepare(
        "SELECT title, snapshot_revision FROM movie_tmdb_data WHERE movie_id = 'legacy'",
      ).first(),
    ).toEqual({ title: "Backfilled", snapshot_revision: expect.any(String) });
  });

  it("does not restore a legacy null-revision link removed during its first backfill", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO movies (id, title, added_at) VALUES ('member-movie', 'Legacy', ?)",
      ).bind(yesterday),
      env.DB.prepare(
        "INSERT INTO movie_tmdb_data (movie_id, tmdb_id, refresh_after) VALUES ('member-movie', 1, '1970-01-01T00:00:00.000Z')",
      ),
    ]);
    const started = deferred<void>();
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        started.resolve();
        return pending.promise;
      }),
    );
    const refresh = refreshDueTmdbData(bindings(), timestamp);
    await started.promise;
    expect((await request("PATCH", { tmdbId: null })).status).toBe(200);
    const memberState = await savedState();
    pending.resolve(providerResponse(snapshot(1, "Obsolete backfill")));

    await expect(refresh).resolves.toEqual({
      attempted: 1,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
      skipped: 1,
    });
    expect(await savedState()).toEqual(memberState);
  });

  it("preserves a member's newer same-identity credits when an unchanged refresh finishes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    const original = snapshot(1, "A");
    await seedMovie("member-movie", original);
    await env.DB.prepare(
      "UPDATE movie_tmdb_data SET refresh_after = '1970-01-01T00:00:00.000Z'",
    ).run();
    const started = deferred<void>();
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        started.resolve();
        return pending.promise;
      }),
    );
    const refresh = refreshDueTmdbData(bindings(), timestamp);
    await started.promise;
    const newer = snapshot(1, "A", timestamp);
    newer.data.cast = [{ id: 900, name: "Newly confirmed actor" }];
    await cache(newer);
    expect((await request("PATCH", { tmdbId: 1 })).status).toBe(200);
    const memberState = await savedState();
    pending.resolve(providerResponse(original));

    await expect(refresh).resolves.toEqual({
      attempted: 1,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
      skipped: 1,
    });
    expect(await savedState()).toEqual(memberState);
  });

  it("uses the newest eligible shared observation when a newer result belongs to an unlinked movie", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(timestamp);
    await seedMovie("member-movie", snapshot(1, "A"));
    const other = snapshot(2, "B");
    other.data.cast = [{ id: 10, name: "Original shared actor" }];
    await seedMovie("other-movie", other);
    await env.DB.prepare(
      "UPDATE movie_tmdb_data SET refresh_after = '1970-01-01T00:00:00.000Z'",
    ).run();
    const bothStarted = deferred<void>();
    const pending = deferred<Response>();
    let startedCount = 0;
    const valid = snapshot(2, "Valid B");
    valid.data.cast = [{ id: 10, name: "Valid shared actor" }];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        startedCount += 1;
        if (startedCount === 2) bothStarted.resolve();
        return input.includes("/movie/1?")
          ? pending.promise
          : Promise.resolve(providerResponse(valid));
      }),
    );
    const refresh = refreshDueTmdbData(bindings(), timestamp);
    await bothStarted.promise;
    expect((await request("PATCH", { tmdbId: null })).status).toBe(200);
    vi.setSystemTime(new Date(timestamp).getTime() + 1000);
    pending.resolve(providerResponse(snapshot(1, "Obsolete A")));

    await expect(refresh).resolves.toEqual({
      attempted: 2,
      failed: 0,
      rateLimited: false,
      refreshed: 1,
      skipped: 1,
    });
    expect(
      await env.DB.prepare(
        "SELECT name FROM tmdb_people WHERE tmdb_id = 10",
      ).first(),
    ).toEqual({ name: "Valid shared actor" });
    expect(
      (
        await env.DB.prepare(
          "SELECT movie_id, title FROM movie_tmdb_data",
        ).all()
      ).results,
    ).toEqual([{ movie_id: "other-movie", title: "Valid B" }]);
    expect(
      (await env.DB.prepare("SELECT tmdb_id FROM tmdb_collections").all())
        .results,
    ).toEqual([{ tmdb_id: 200 }]);
  });
});
