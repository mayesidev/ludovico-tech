import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshDueTmdbData, replaceTmdbDataStatements } from "./tmdb-data";
import type { TmdbMovieResult } from "./tmdb";

const timestamp = "2026-08-23T12:00:00.000Z";

const insertLinkedMovie = async (id: string, tmdbId: number) => {
  await env.DB.prepare(
    `INSERT INTO movies
     (id, title, title_normalized, added_at, updated_at, imdb_id, tmdb_id,
      tmdb_fetched_at, version, version_runtime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `Library ${id}`,
      `library ${id}`,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      `tt${String(tmdbId).padStart(7, "0")}`,
      tmdbId,
      "2026-01-01T00:00:00.000Z",
      "Library Cut",
      130,
    )
    .run();
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

    const report = await refreshDueTmdbData(env, timestamp);

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
        `SELECT movie_tmdb_data.title, movie_tmdb_data.data_version,
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
      data_version: 1,
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

    expect(await refreshDueTmdbData(env, timestamp)).toEqual({
      attempted: 0,
      failed: 0,
      rateLimited: false,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops a batch on rate limiting without advancing pending rows", async () => {
    await insertLinkedMovie("rate-limited-one", 51);
    await insertLinkedMovie("rate-limited-two", 52);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshDueTmdbData(env, timestamp)).toEqual({
      attempted: 1,
      failed: 1,
      rateLimited: true,
      refreshed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_tmdb_data WHERE data_version = 0",
      ).first(),
    ).toEqual({ count: 2 });
  });

  it("adopts a relink made by the rollback-compatible application", async () => {
    await insertLinkedMovie("rollback-relink", 53);
    await env.DB.batch(
      replaceTmdbDataStatements(env, "rollback-relink", {
        data: {
          cast: [{ id: 303, name: "Earlier Actor" }],
          collection: null,
          directors: [],
          id: 53,
          posterPath: null,
          releaseDate: null,
          runtimeMinutes: null,
          title: "Earlier TMDB Title",
        },
        fetchedAt: "2026-08-20T00:00:00.000Z",
      }),
    );
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE movies
         SET tmdb_id = 54, tmdb_fetched_at = ?
         WHERE id = 'rollback-relink'`,
      ).bind("2026-08-22T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO tmdb_people (tmdb_id, name, updated_at, fetched_at)
         VALUES (304, 'Relinked Actor', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare("DELETE FROM movie_credits WHERE movie_id = ?").bind(
        "rollback-relink",
      ),
      env.DB.prepare(
        `INSERT INTO movie_credits
         (movie_id, tmdb_person_id, credit_type, position)
         VALUES ('rollback-relink', 304, 'cast', 1)`,
      ),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );

    expect(await refreshDueTmdbData(env, timestamp)).toMatchObject({
      attempted: 1,
      rateLimited: true,
      refreshed: 0,
    });
    expect(
      await env.DB.prepare(
        `SELECT movie_tmdb_data.tmdb_id, movie_tmdb_data.data_version,
                tmdb_people.name
         FROM movie_tmdb_data
         JOIN movie_credits
           ON movie_credits.movie_id = movie_tmdb_data.movie_id
         JOIN tmdb_people
           ON tmdb_people.tmdb_id = movie_credits.tmdb_person_id
         WHERE movie_tmdb_data.movie_id = 'rollback-relink'`,
      ).first(),
    ).toEqual({
      data_version: 0,
      name: "Relinked Actor",
      tmdb_id: 54,
    });
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
      replaceTmdbDataStatements(env, "ordered-snapshot", newer),
    );
    await env.DB.batch(
      replaceTmdbDataStatements(env, "ordered-snapshot", older),
    );

    expect(
      await env.DB.prepare(
        `SELECT movie_tmdb_data.title, tmdb_collections.name AS collection_name,
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
      person_name: "Newer Actor",
      title: "Newer Title",
    });
  });

  it("deletes only unreferenced shared TMDB entities", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tmdb_people (tmdb_id, name, updated_at, fetched_at)
         VALUES (401, 'Orphan Person', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO tmdb_collections (tmdb_id, name, fetched_at)
         VALUES (90, 'Orphan Collection', ?)`,
      ).bind(timestamp),
    ]);

    await refreshDueTmdbData(env, timestamp);

    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM tmdb_people").first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tmdb_collections",
      ).first(),
    ).toEqual({ count: 0 });
  });
});
