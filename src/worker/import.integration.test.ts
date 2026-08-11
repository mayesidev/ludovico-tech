import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  buildTmdbMetadataPlan,
  renderSqlChunks,
  type GeneralizedImportDocument,
  type TmdbReconciliationDocument,
} from "../../scripts/import-sheet-lib";

const syntheticCatalog: GeneralizedImportDocument = {
  nowShowingSourceRow: 3,
  rows: [
    {
      collectionIndicated: true,
      collectionName: "Synthetic Saga",
      legacyImdbId: "tt1234567",
      priorViewed: true,
      rating: { phrase: "A synthetic delight", score: 4.5 },
      sourceRow: 2,
      submittedAt: "2026-08-01T10:30:00.000Z",
      title: "Synthetic Movie One",
    },
    {
      collectionIndicated: true,
      collectionName: "Synthetic Saga",
      legacyImdbId: "tt1234568",
      priorViewed: false,
      rating: null,
      sourceRow: 3,
      submittedAt: "2026-08-02T10:30:00.000Z",
      title: "Synthetic Movie Two",
    },
  ],
  schemaVersion: 3,
  validated: true,
};

const worker = exports.default;

const syntheticReconciliation: TmdbReconciliationDocument = {
  complete: true,
  generatedAt: "2026-08-10T10:00:00.000Z",
  matches: [
    {
      legacyImdbId: "tt1234568",
      posterPath: "/synthetic-two.jpg",
      providerTitleNormalized: "synthetic movie two",
      releaseDate: "2024-01-02",
      runtimeMinutes: 123,
      sourceTitleNormalized: "synthetic movie two",
      tmdbCollectionId: 7,
      tmdbCollectionName: "Synthetic Collection",
      tmdbId: 42,
    },
  ],
  schemaVersion: 3,
};

const request = async <T>(path: string, init?: RequestInit) => {
  const response = await worker.fetch(
    new Request(`https://ludovico-tech.test${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    }),
  );
  return { body: (await response.json()) as T, response };
};

const importSyntheticCatalog = async (executions = 1) => {
  const plan = await buildImportPlan(
    syntheticCatalog,
    "2026-08-06T20:00:00.000Z",
  );
  const chunks = renderSqlChunks(plan.statements, 3);
  for (let execution = 0; execution < executions; execution += 1) {
    for (const chunk of chunks) await env.DB.exec(chunk.sql);
  }
  return plan;
};

describe("generalized catalog import", () => {
  it("executes every generated chunk idempotently", async () => {
    const plan = await importSyntheticCatalog(2);
    const movies = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movies",
    ).first<{ count: number }>();
    const sources = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movie_import_sources",
    ).first<{ count: number }>();
    const collections = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM collections",
    ).first<{ count: number }>();
    const ratingCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ratings",
    ).first<{ count: number }>();

    expect({
      collections: collections?.count,
      movies: movies?.count,
      ratings: ratingCount?.count,
      sources: sources?.count,
    }).toEqual(plan.counts);
  });

  it("keeps submission time as added time without inventing a legacy watch time", async () => {
    await importSyntheticCatalog();
    const importedMovie = await env.DB.prepare(
      `SELECT movies.added_at, ratings.phrase, ratings.recorded_at,
              ratings.score, ratings.watched_at
       FROM movies
       INNER JOIN ratings ON ratings.movie_id = movies.id`,
    ).first<{
      added_at: string;
      phrase: string;
      recorded_at: string;
      score: number;
      watched_at: string | null;
    }>();

    expect(importedMovie).toEqual({
      added_at: "2026-08-01T10:30:00.000Z",
      phrase: "A synthetic delight",
      recorded_at: "2026-08-06T20:00:00.000Z",
      score: 4.5,
      watched_at: null,
    });
  });

  it("leaves external identity and collection order unconfirmed", async () => {
    await importSyntheticCatalog();
    const tmdbLinkCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movies WHERE tmdb_id IS NOT NULL",
    ).first<{ count: number }>();
    const collection = await env.DB.prepare(
      "SELECT order_confirmed FROM collections",
    ).first<{ order_confirmed: number }>();

    expect(tmdbLinkCount?.count).toBe(0);
    expect(collection?.order_confirmed).toBe(0);
  });

  it("applies a confirmed external match idempotently to an existing import", async () => {
    await importSyntheticCatalog();
    const plan = await buildImportPlan(
      syntheticCatalog,
      "2026-08-10T11:00:00.000Z",
      syntheticReconciliation,
    );
    for (const chunk of renderSqlChunks(plan.statements, 3)) {
      await env.DB.exec(chunk.sql);
      await env.DB.exec(chunk.sql);
    }

    const movie = await env.DB.prepare(
      `SELECT title, release_date, poster_path, runtime_minutes, tmdb_id,
        tmdb_collection_id, tmdb_collection_name, tmdb_fetched_at
       FROM movies WHERE legacy_imdb_id = ?`,
    )
      .bind("tt1234568")
      .first();

    expect(plan.diagnostics).toEqual([]);
    expect(movie).toEqual({
      poster_path: "/synthetic-two.jpg",
      release_date: "2024-01-02",
      runtime_minutes: 123,
      title: "Synthetic Movie Two",
      tmdb_collection_id: 7,
      tmdb_collection_name: "Synthetic Collection",
      tmdb_fetched_at: "2026-08-10T10:00:00.000Z",
      tmdb_id: 42,
    });
  });

  it("updates metadata without replaying structure after a collection label changes", async () => {
    await importSyntheticCatalog();
    const correctedCatalog: GeneralizedImportDocument = {
      ...syntheticCatalog,
      rows: syntheticCatalog.rows.map((movie) => ({
        ...movie,
        collectionName: "Corrected Synthetic Saga",
      })),
    };
    const plan = buildTmdbMetadataPlan(
      correctedCatalog,
      syntheticReconciliation,
      "2026-08-10T11:00:00.000Z",
    );
    for (const chunk of renderSqlChunks(plan.statements, 1)) {
      await env.DB.exec(chunk.sql);
      await env.DB.exec(chunk.sql);
    }

    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM movies) AS movies,
              (SELECT COUNT(*) FROM collections) AS collections,
              (SELECT COUNT(*) FROM ratings) AS ratings,
              (SELECT COUNT(*) FROM movie_import_sources) AS sources`,
    ).first();
    const linked = await env.DB.prepare(
      "SELECT title, tmdb_id FROM movies WHERE legacy_imdb_id = ?",
    )
      .bind("tt1234568")
      .first();

    expect(plan.statements).toHaveLength(1);
    expect(counts).toEqual({
      collections: 1,
      movies: 2,
      ratings: 1,
      sources: 2,
    });
    expect(linked).toEqual({ title: "Synthetic Movie Two", tmdb_id: 42 });
  });

  it("restores the active collection selection ready to rate without fabricated roll history", async () => {
    await importSyntheticCatalog(2);
    const current = await env.DB.prepare(
      `SELECT now_showing.rolled_movie_id, now_showing.rolled_at,
              now_showing.status, movies.title, collections.name AS collection_name
       FROM now_showing
       LEFT JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN collections ON collections.id = now_showing.collection_id
       WHERE now_showing.id = 1`,
    ).first();
    const rollCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rolls",
    ).first<{ count: number }>();
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log",
    ).first<{ count: number }>();

    expect(current).toEqual({
      collection_name: "Synthetic Saga",
      rolled_at: null,
      rolled_movie_id: null,
      status: "ready",
      title: "Synthetic Movie Two",
    });
    expect(rollCount?.count).toBe(0);
    expect(auditCount?.count).toBe(0);
  });

  it("confirms and rates a collection selection with stable imported IDs", async () => {
    await importSyntheticCatalog();
    const members = await env.DB.prepare(
      `SELECT collections.id AS collection_id, movies.id,
              CASE WHEN ratings.id IS NULL THEN 0 ELSE 1 END AS watched
       FROM collection_movies
       JOIN collections ON collections.id = collection_movies.collection_id
       JOIN movies ON movies.id = collection_movies.movie_id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       ORDER BY collection_movies.position`,
    ).all<{ collection_id: string; id: string; watched: number }>();
    const collectionId = members.results[0]?.collection_id;
    const unwatchedId = members.results.find((movie) => !movie.watched)?.id;

    expect(collectionId).toMatch(/^collection_/);
    expect(members.results.map((movie) => movie.id)).toEqual([
      expect.stringMatching(/^movie_/),
      expect.stringMatching(/^movie_/),
    ]);
    expect(unwatchedId).toEqual(expect.stringMatching(/^movie_/));

    const ordered = await request<{
      nowShowing: { movie_id: string; status: string };
    }>(`/api/collections/${collectionId}/order`, {
      body: JSON.stringify({
        movieIds: members.results.map((movie) => movie.id),
      }),
      method: "POST",
    });
    expect(ordered.response.status).toBe(200);
    expect(ordered.body.nowShowing).toMatchObject({
      movie_id: unwatchedId,
      status: "ready",
    });

    const rated = await request<{
      nowShowing: { movie_id: string; status: string };
    }>(`/api/movies/${unwatchedId}/rate`, {
      body: JSON.stringify({ phrase: "Imported workflow works", score: 4 }),
      method: "POST",
    });
    expect(rated.response.status).toBe(200);
    expect(rated.body.nowShowing).toMatchObject({
      movie_id: unwatchedId,
      status: "watched",
    });
  });
});
