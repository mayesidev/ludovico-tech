import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTmdbCreditSnapshots,
  purgeExpiredTmdbData,
  refreshDueTmdbData,
  replaceTmdbDataStatements,
  type TmdbCreditSnapshot,
} from "./tmdb-data";
import type { TmdbMovieResult } from "./tmdb";
import type { AppEnv } from "./env";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";

const timestamp = "2026-08-23T12:00:00.000Z";
const tmdbEnv = () =>
  ({
    ...env,
    TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
  }) as AppEnv["Bindings"];

const trackOrphanCleanup = () => {
  let prepared = 0;
  const bindings = tmdbEnv();
  return {
    bindings: {
      ...bindings,
      DB: {
        batch: (statements: D1PreparedStatement[]) =>
          bindings.DB.batch(statements),
        prepare: (query: string) => {
          if (
            query.includes("DELETE FROM tmdb_people") ||
            query.includes("DELETE FROM tmdb_collections")
          ) {
            prepared += 1;
          }
          return bindings.DB.prepare(query);
        },
      } as D1Database,
    } as AppEnv["Bindings"],
    prepared: () => prepared,
  };
};

const trackDatabaseCalls = () => {
  let batches = 0;
  const preparedQueries: string[] = [];
  const bindings = tmdbEnv();
  return {
    batches: () => batches,
    bindings: {
      ...bindings,
      DB: {
        batch: (statements: D1PreparedStatement[]) => {
          batches += 1;
          return bindings.DB.batch(statements);
        },
        prepare: (query: string) => {
          preparedQueries.push(query);
          return bindings.DB.prepare(query);
        },
      } as D1Database,
    } as AppEnv["Bindings"],
    preparedQueries,
  };
};

const insertLinkedMovie = async (id: string, tmdbId: number) => {
  await env.DB.prepare(
    `INSERT INTO movies
     (id, title, title_normalized, added_at, updated_at, imdb_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `Library ${id}`,
      `library ${id}`,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      `tt${String(tmdbId).padStart(7, "0")}`,
    )
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO movie_tmdb_data
       (movie_id, tmdb_id, refresh_after)
       VALUES (?, ?, '1970-01-01T00:00:00.000Z')`,
    ).bind(id, tmdbId),
    env.DB.prepare(
      `UPDATE movies
       SET version = 'Library Cut', version_runtime = 130
       WHERE id = ?`,
    ).bind(id),
  ]);
};

const responseFor = (tmdbId: number) =>
  new Response(
    JSON.stringify({
      belongs_to_collection: { id: 70, name: "Current TMDB Collection" },
      credits: {
        cast: [{ id: 101, name: "Current Actor", order: 0 }],
        crew: [{ id: 201, job: "Director", name: "Current Director" }],
      },
      id: tmdbId,
      poster_path: "/current.jpg",
      release_date: "2025-01-02",
      runtime: 125,
      title: "Current TMDB Title",
    }),
    { status: 200 },
  );

const creditResult = (
  tmdbId: number,
  castIds: number[],
  directorIds: number[],
  fetchedAt: string,
): TmdbMovieResult => ({
  data: {
    cast: castIds.map((id) => ({ id, name: `Person ${id}` })),
    collection: null,
    directors: directorIds.map((id) => ({ id, name: `Person ${id}` })),
    id: tmdbId,
    posterPath: null,
    releaseDate: null,
    runtimeMinutes: null,
    title: `TMDB title ${tmdbId}`,
  },
  fetchedAt,
});

const installCreditWriteTracking = () =>
  env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS credit_write_events (action TEXT NOT NULL)",
    ),
    env.DB.prepare(
      `CREATE TRIGGER IF NOT EXISTS track_credit_insert
       AFTER INSERT ON movie_credits
       BEGIN
         INSERT INTO credit_write_events (action) VALUES ('insert');
       END`,
    ),
    env.DB.prepare(
      `CREATE TRIGGER IF NOT EXISTS track_credit_delete
       AFTER DELETE ON movie_credits
       BEGIN
         INSERT INTO credit_write_events (action) VALUES ('delete');
       END`,
    ),
    env.DB.prepare("DELETE FROM credit_write_events"),
  ]);

afterEach(() => vi.unstubAllGlobals());

describe("scheduled TMDB enrichment refresh", () => {
  it("refreshes due enrichment without changing Library-owned data", async () => {
    await insertLinkedMovie("scheduled-movie", 42);
    await env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        "library-collection",
        "Library Collection",
        "library collection",
        timestamp,
        timestamp,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO collection_movies (collection_id, movie_id, position)
       VALUES (?, ?, 1)`,
    )
      .bind("library-collection", "scheduled-movie")
      .run();
    await env.DB.prepare(
      `INSERT INTO ratings
       (id, movie_id, recorded_at, watched_at, score, phrase, source)
       VALUES (?, ?, ?, ?, ?, ?, 'application')`,
    )
      .bind(
        "scheduled-rating",
        "scheduled-movie",
        timestamp,
        timestamp,
        4.5,
        "Library rating",
      )
      .run();
    const fetchMock = vi.fn().mockResolvedValue(responseFor(42));
    vi.stubGlobal("fetch", fetchMock);

    const report = await refreshDueTmdbData(tmdbEnv(), timestamp);

    expect(report).toEqual({
      attempted: 1,
      failed: 0,
      rateLimited: false,
      refreshed: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        `SELECT movies.title, movies.imdb_id, movies.version,
                movies.version_runtime, ratings.phrase,
                collection_movies.collection_id
         FROM movies
         JOIN ratings ON ratings.movie_id = movies.id
         JOIN collection_movies ON collection_movies.movie_id = movies.id
         WHERE movies.id = ?`,
      )
        .bind("scheduled-movie")
        .first(),
    ).toEqual({
      collection_id: "library-collection",
      imdb_id: "tt0000042",
      phrase: "Library rating",
      title: "Library scheduled-movie",
      version: "Library Cut",
      version_runtime: 130,
    });
    expect(
      await env.DB.prepare(
        `SELECT movie_tmdb_data.title, movie_tmdb_data.contract_id,
                tmdb_collections.name AS collection_name
         FROM movie_tmdb_data
         LEFT JOIN tmdb_collections
           ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
         WHERE movie_tmdb_data.movie_id = ?`,
      )
        .bind("scheduled-movie")
        .first(),
    ).toEqual({
      collection_name: "Current TMDB Collection",
      contract_id: await getTmdbMetadataContractId(),
      title: "Current TMDB Title",
    });
    expect(
      await env.DB.prepare(
        "SELECT name, fetched_at FROM tmdb_people ORDER BY tmdb_id",
      ).all(),
    ).toMatchObject({
      results: [
        { fetched_at: expect.any(String), name: "Current Actor" },
        { fetched_at: expect.any(String), name: "Current Director" },
      ],
    });

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toEqual({
      attempted: 0,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops launching fetches after a rate-limited concurrency window", async () => {
    for (let index = 1; index <= 7; index += 1) {
      await insertLinkedMovie(`rate-limited-${index}`, 50 + index);
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toEqual({
      attempted: 6,
      failed: 6,
      rateLimited: true,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_tmdb_data WHERE contract_id IS NULL",
      ).first(),
    ).toEqual({ count: 7 });
    expect(
      await env.DB.prepare(
        `SELECT last_refresh_attempt_at, last_refresh_status
         FROM movie_tmdb_data WHERE movie_id = 'rate-limited-7'`,
      ).first(),
    ).toEqual({ last_refresh_attempt_at: null, last_refresh_status: null });
  });

  it("halts a batch on a shared credential failure and preserves unattempted rows", async () => {
    for (let index = 1; index <= 7; index += 1) {
      await insertLinkedMovie(`credential-failure-${index}`, 60 + index);
    }
    await env.DB.batch([
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS tmdb_data_write_events (movie_id TEXT NOT NULL)",
      ),
      env.DB.prepare(
        `CREATE TRIGGER IF NOT EXISTS track_tmdb_data_update
         AFTER UPDATE ON movie_tmdb_data
         BEGIN
           INSERT INTO tmdb_data_write_events (movie_id) VALUES (NEW.movie_id);
         END`,
      ),
      env.DB.prepare("DELETE FROM tmdb_data_write_events"),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toEqual({
      attempted: 6,
      failed: 6,
      haltedReason: "TMDB credentials were rejected (HTTP 401)",
      rateLimited: false,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tmdb_data_write_events",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        `SELECT last_refresh_attempt_at, last_refresh_error, last_refresh_status
         FROM movie_tmdb_data WHERE movie_id = 'credential-failure-1'`,
      ).first(),
    ).toEqual({
      last_refresh_attempt_at: null,
      last_refresh_error: null,
      last_refresh_status: null,
    });
    expect(
      await env.DB.prepare(
        `SELECT last_refresh_attempt_at, last_refresh_error, last_refresh_status
         FROM movie_tmdb_data WHERE movie_id = 'credential-failure-7'`,
      ).first(),
    ).toEqual({
      last_refresh_attempt_at: null,
      last_refresh_error: null,
      last_refresh_status: null,
    });
  });

  it("logs a sanitized transport diagnostic for a shared network failure", async () => {
    for (let index = 1; index <= 7; index += 1) {
      await insertLinkedMovie(`network-failure-${index}`, 120 + index);
    }
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("failed with test-tmdb-token"));
    vi.stubGlobal("fetch", fetchMock);
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toMatchObject({
      attempted: 6,
      failed: 6,
      haltedReason: "TMDB could not be reached",
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(errorLog).toHaveBeenCalledWith("TMDB refresh batch halted", {
      diagnostic: "TypeError: failed with [redacted]",
      failureKind: "network",
      upstreamStatus: null,
    });
  });

  it("continues after title-specific not-found responses", async () => {
    for (let index = 1; index <= 7; index += 1) {
      await insertLinkedMovie(`not-found-${index}`, 100 + index);
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toEqual({
      attempted: 7,
      failed: 7,
      rateLimited: false,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM movie_tmdb_data
         WHERE last_refresh_error = 'TMDB title was not found (HTTP 404)'`,
      ).first(),
    ).toEqual({ count: 7 });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM movie_tmdb_data
         WHERE last_refresh_status = 'failed' AND refresh_after = ?`,
      )
        .bind(timestamp)
        .first(),
    ).toEqual({ count: 7 });
  });

  it("processes untouched due titles before retrying an individual failure", async () => {
    await insertLinkedMovie("retry-a-failure", 131);
    await insertLinkedMovie("retry-b-next", 132);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(responseFor(132));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp, 1)).toMatchObject({
      attempted: 1,
      failed: 1,
      refreshed: 0,
    });
    expect(await refreshDueTmdbData(tmdbEnv(), timestamp, 1)).toMatchObject({
      attempted: 1,
      failed: 0,
      refreshed: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/3/movie/131",
    );
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe(
      "/3/movie/132",
    );
  });

  it("uses a freshness-only write for an unchanged cached snapshot", async () => {
    await insertLinkedMovie("cached-title", 71);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseFor(71))
      .mockResolvedValueOnce(responseFor(72));
    vi.stubGlobal("fetch", fetchMock);

    await refreshDueTmdbData(tmdbEnv(), timestamp);
    await env.DB.prepare(
      "UPDATE movie_tmdb_data SET refresh_after = ? WHERE movie_id = ?",
    )
      .bind("1970-01-01T00:00:00.000Z", "cached-title")
      .run();
    await insertLinkedMovie("cache-miss-title", 72);
    const tracked = trackDatabaseCalls();

    expect(await refreshDueTmdbData(tracked.bindings, timestamp, 2)).toEqual({
      attempted: 2,
      failed: 0,
      rateLimited: false,
      refreshed: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tracked.batches()).toBe(1);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.includes("SELECT cache_key, payload_json, fetched_at"),
      ),
    ).toHaveLength(1);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.includes("SELECT movie_id, tmdb_person_id, credit_type"),
      ),
    ).toHaveLength(1);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.includes("INSERT INTO tmdb_people"),
      ),
    ).toHaveLength(2);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.includes("INSERT INTO tmdb_collections"),
      ),
    ).toHaveLength(1);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.trimStart().startsWith("UPDATE movie_tmdb_data SET"),
      ),
    ).toEqual([expect.not.stringContaining("tmdb_collection_id =")]);
    expect(
      tracked.preparedQueries.filter((query) =>
        query.includes("INSERT INTO movie_tmdb_data"),
      ),
    ).toHaveLength(1);
  });

  it("records provider failures without discarding successful titles", async () => {
    await insertLinkedMovie("partial-a-success", 73);
    await insertLinkedMovie("partial-b-failure", 74);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(responseFor(73))
        .mockResolvedValueOnce(new Response(null, { status: 502 })),
    );

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp, 2)).toEqual({
      attempted: 2,
      failed: 1,
      rateLimited: false,
      refreshed: 1,
    });
    expect(
      await env.DB.prepare(
        `SELECT movie_id, title, last_refresh_status
         FROM movie_tmdb_data
         WHERE movie_id IN ('partial-a-success', 'partial-b-failure')
         ORDER BY movie_id`,
      ).all(),
    ).toMatchObject({
      results: [
        {
          last_refresh_status: "succeeded",
          movie_id: "partial-a-success",
          title: "Current TMDB Title",
        },
        {
          last_refresh_status: "failed",
          movie_id: "partial-b-failure",
          title: null,
        },
      ],
    });
  });

  it("never exceeds six simultaneous TMDB requests", async () => {
    for (let index = 1; index <= 7; index += 1) {
      await insertLinkedMovie(`concurrent-${index}`, 80 + index);
    }
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeRequests -= 1;
      const tmdbId = Number(new URL(String(input)).pathname.split("/").at(-1));
      return responseFor(tmdbId);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp, 7)).toMatchObject({
      attempted: 7,
      failed: 0,
      refreshed: 7,
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(maximumActiveRequests).toBe(6);
  });

  it("rolls back every validated snapshot when batch persistence fails", async () => {
    await insertLinkedMovie("atomic-title", 75);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFor(75)));
    const bindings = tmdbEnv();
    let batchCall = 0;
    const failingBindings = {
      ...bindings,
      DB: {
        batch: (statements: D1PreparedStatement[]) => {
          batchCall += 1;
          return bindings.DB.batch(
            batchCall === 1
              ? [
                  ...statements,
                  bindings.DB.prepare(
                    `INSERT INTO tmdb_people (tmdb_id, name, fetched_at)
                       VALUES (-1, 'Invalid person', ?)`,
                  ).bind(timestamp),
                ]
              : statements,
          );
        },
        prepare: (query: string) => bindings.DB.prepare(query),
      } as D1Database,
    } as AppEnv["Bindings"];

    await expect(
      refreshDueTmdbData(failingBindings, timestamp),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare(
        `SELECT title, fetched_at FROM movie_tmdb_data
         WHERE movie_id = 'atomic-title'`,
      ).first(),
    ).toEqual({ fetched_at: null, title: null });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM tmdb_cache").first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM tmdb_people").first(),
    ).toEqual({ count: 0 });
  });

  it("skips orphan cleanup when a batch abandons no shared metadata", async () => {
    await insertLinkedMovie("cleanup-batch-one", 81);
    await insertLinkedMovie("cleanup-batch-two", 82);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseFor(81))
      .mockResolvedValueOnce(responseFor(82));
    vi.stubGlobal("fetch", fetchMock);
    const tracked = trackOrphanCleanup();

    expect(await refreshDueTmdbData(tracked.bindings, timestamp, 2)).toEqual({
      attempted: 2,
      failed: 0,
      rateLimited: false,
      refreshed: 2,
    });
    expect(tracked.prepared()).toBe(0);

    expect(await refreshDueTmdbData(tracked.bindings, timestamp, 2)).toEqual({
      attempted: 0,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
    });
    expect(tracked.prepared()).toBe(0);
  });

  it("does not synthesize TMDB links from Library records", async () => {
    await env.DB.prepare(
      `INSERT INTO movies
       (id, title, title_normalized, added_at, updated_at)
       VALUES ('library-only', 'Library Only', 'library only', ?, ?)`,
    )
      .bind(timestamp, timestamp)
      .run();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(tmdbEnv(), timestamp)).toEqual({
      attempted: 0,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_tmdb_data",
      ).first(),
    ).toEqual({ count: 0 });
  });

  it("does not let an older response regress shared names or credits", async () => {
    await insertLinkedMovie("ordered-snapshot", 61);
    const newer: TmdbMovieResult = {
      data: {
        cast: [{ id: 301, name: "Newer Actor" }],
        collection: { id: 80, name: "Newer Collection" },
        directors: [],
        id: 61,
        posterPath: null,
        releaseDate: null,
        runtimeMinutes: null,
        title: "Newer Title",
      },
      fetchedAt: "2026-08-20T00:00:00.000Z",
    };
    const older: TmdbMovieResult = {
      data: {
        ...newer.data,
        cast: [{ id: 301, name: "Older Actor" }],
        collection: { id: 80, name: "Older Collection" },
        title: "Older Title",
      },
      fetchedAt: "2026-08-10T00:00:00.000Z",
    };

    await env.DB.batch(
      await replaceTmdbDataStatements(env, "ordered-snapshot", newer),
    );
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "ordered-snapshot", older),
    );

    expect(
      await env.DB.prepare(
        `SELECT movie_tmdb_data.title,
                movie_tmdb_data.last_refresh_status,
                tmdb_collections.name AS collection_name,
                tmdb_people.name AS person_name
         FROM movie_tmdb_data
         JOIN tmdb_collections
           ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
         JOIN movie_credits
           ON movie_credits.movie_id = movie_tmdb_data.movie_id
         JOIN tmdb_people
           ON tmdb_people.tmdb_id = movie_credits.tmdb_person_id
         WHERE movie_tmdb_data.movie_id = ?`,
      )
        .bind("ordered-snapshot")
        .first(),
    ).toEqual({
      collection_name: "Newer Collection",
      last_refresh_status: "succeeded",
      person_name: "Newer Actor",
      title: "Newer Title",
    });
  });

  it("deletes only abandoned TMDB entities from the refreshed batch", async () => {
    await insertLinkedMovie("cleanup-candidate", 91);
    await insertLinkedMovie("cleanup-shared", 92);
    const oldCandidate: TmdbMovieResult = {
      data: {
        cast: [
          { id: 401, name: "Abandoned Person" },
          { id: 402, name: "Shared Person" },
        ],
        collection: { id: 90, name: "Abandoned Collection" },
        directors: [],
        id: 91,
        posterPath: null,
        releaseDate: null,
        runtimeMinutes: null,
        title: "Old Candidate",
      },
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    const sharedReference: TmdbMovieResult = {
      data: {
        cast: [{ id: 402, name: "Shared Person" }],
        collection: { id: 92, name: "Retained Collection" },
        directors: [],
        id: 92,
        posterPath: null,
        releaseDate: null,
        runtimeMinutes: null,
        title: "Shared Reference",
      },
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "cleanup-candidate", oldCandidate),
    );
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "cleanup-shared", sharedReference),
    );
    await env.DB.prepare(
      `UPDATE movie_tmdb_data
       SET refresh_after = '1970-01-01T00:00:00.000Z', contract_id = NULL
       WHERE movie_id = 'cleanup-candidate'`,
    ).run();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFor(91)));
    const tracked = trackOrphanCleanup();

    await refreshDueTmdbData(tracked.bindings, timestamp, 1);

    expect(tracked.prepared()).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT tmdb_id FROM tmdb_people WHERE tmdb_id IN (401, 402) ORDER BY tmdb_id",
      ).all(),
    ).toMatchObject({ results: [{ tmdb_id: 402 }] });
    expect(
      await env.DB.prepare(
        "SELECT tmdb_id FROM tmdb_collections WHERE tmdb_id IN (90, 92) ORDER BY tmdb_id",
      ).all(),
    ).toMatchObject({ results: [{ tmdb_id: 92 }] });
  });

  it("purges expired supplemental data while retaining Library data and the TMDB link", async () => {
    await insertLinkedMovie("expired-metadata", 93);
    const expired: TmdbMovieResult = {
      data: {
        cast: [{ id: 501, name: "Expired Actor" }],
        collection: { id: 94, name: "Expired Collection" },
        directors: [{ id: 502, name: "Expired Director" }],
        id: 93,
        posterPath: "/expired.jpg",
        releaseDate: "2020-01-01",
        runtimeMinutes: 121,
        title: "Expired Provider Title",
      },
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    await env.DB.batch(
      await replaceTmdbDataStatements(env, "expired-metadata", expired),
    );

    await expect(purgeExpiredTmdbData(tmdbEnv(), timestamp)).resolves.toBe(1);

    expect(
      await env.DB.prepare(
        `SELECT movies.title, movies.version,
                movie_tmdb_data.tmdb_id, movie_tmdb_data.title AS tmdb_title,
                movie_tmdb_data.release_date, movie_tmdb_data.poster_path,
                movie_tmdb_data.runtime_minutes,
                movie_tmdb_data.tmdb_collection_id,
                movie_tmdb_data.expired_at
         FROM movies
         JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
         WHERE movies.id = 'expired-metadata'`,
      ).first(),
    ).toEqual({
      expired_at: timestamp,
      poster_path: null,
      release_date: null,
      runtime_minutes: null,
      title: "Library expired-metadata",
      tmdb_collection_id: null,
      tmdb_id: 93,
      tmdb_title: null,
      version: "Library Cut",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_credits WHERE movie_id = 'expired-metadata'",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tmdb_people WHERE tmdb_id IN (501, 502)",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tmdb_collections WHERE tmdb_id = 94",
      ).first(),
    ).toEqual({ count: 0 });

    await env.DB.batch(
      await replaceTmdbDataStatements(env, "expired-metadata", {
        ...expired,
        fetchedAt: timestamp,
      }),
    );
    expect(
      await env.DB.prepare(
        `SELECT expired_at, title FROM movie_tmdb_data
         WHERE movie_id = 'expired-metadata'`,
      ).first(),
    ).toEqual({ expired_at: null, title: "Expired Provider Title" });
  });
});

describe("TMDB credit snapshot persistence", () => {
  it.each<{
    expectedActions: string[];
    expectedCredits: TmdbCreditSnapshot[];
    initialCast: number[];
    initialDirectors: number[];
    name: string;
    nextCast: number[];
    nextDirectors: number[];
  }>([
    {
      expectedActions: [],
      expectedCredits: [
        { creditType: "cast", personId: 101, position: 1 },
        { creditType: "cast", personId: 102, position: 2 },
        { creditType: "director", personId: 201, position: 1 },
      ],
      initialCast: [101, 102],
      initialDirectors: [201],
      name: "preserves an unchanged ordered snapshot",
      nextCast: [101, 102],
      nextDirectors: [201],
    },
    {
      expectedActions: ["insert"],
      expectedCredits: [
        { creditType: "cast", personId: 101, position: 1 },
        { creditType: "cast", personId: 102, position: 2 },
      ],
      initialCast: [101],
      initialDirectors: [],
      name: "inserts an added credit",
      nextCast: [101, 102],
      nextDirectors: [],
    },
    {
      expectedActions: ["delete"],
      expectedCredits: [{ creditType: "cast", personId: 101, position: 1 }],
      initialCast: [101, 102],
      initialDirectors: [],
      name: "deletes a removed credit",
      nextCast: [101],
      nextDirectors: [],
    },
    {
      expectedActions: ["delete", "delete", "insert", "insert"],
      expectedCredits: [
        { creditType: "cast", personId: 102, position: 1 },
        { creditType: "cast", personId: 101, position: 2 },
      ],
      initialCast: [101, 102],
      initialDirectors: [],
      name: "rewrites only reordered credits",
      nextCast: [102, 101],
      nextDirectors: [],
    },
    {
      expectedActions: ["delete", "insert"],
      expectedCredits: [{ creditType: "director", personId: 101, position: 1 }],
      initialCast: [101],
      initialDirectors: [],
      name: "moves a person between credit roles",
      nextCast: [],
      nextDirectors: [101],
    },
  ])(
    "$name",
    async ({
      expectedActions,
      expectedCredits,
      initialCast,
      initialDirectors,
      nextCast,
      nextDirectors,
    }) => {
      await insertLinkedMovie("credit-diff", 91);
      await env.DB.batch(
        await replaceTmdbDataStatements(
          env,
          "credit-diff",
          creditResult(
            91,
            initialCast,
            initialDirectors,
            "2026-08-01T00:00:00.000Z",
          ),
        ),
      );
      await installCreditWriteTracking();

      await env.DB.batch(
        await replaceTmdbDataStatements(
          env,
          "credit-diff",
          creditResult(91, nextCast, nextDirectors, "2026-08-02T00:00:00.000Z"),
        ),
      );

      expect(
        await env.DB.prepare(
          "SELECT action FROM credit_write_events ORDER BY rowid",
        ).all(),
      ).toMatchObject({
        results: expectedActions.map((action) => ({ action })),
      });
      expect(
        (await getTmdbCreditSnapshots(env, ["credit-diff"])).get("credit-diff"),
      ).toEqual(expectedCredits);
    },
  );
});
