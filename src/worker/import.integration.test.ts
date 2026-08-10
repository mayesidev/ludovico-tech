import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  renderSqlChunks,
  type GeneralizedImportDocument,
} from "../../scripts/import-sheet-lib";

const syntheticCatalog: GeneralizedImportDocument = {
  nowShowingSourceRow: 3,
  rows: [
    {
      franchiseIndicated: true,
      franchiseName: "Synthetic Saga",
      legacyImdbId: "tt1234567",
      priorViewed: true,
      rating: { phrase: "A synthetic delight", score: 4.5 },
      sourceRow: 2,
      submittedAt: "2026-08-01T10:30:00.000Z",
      title: "Synthetic Movie One",
    },
    {
      franchiseIndicated: true,
      franchiseName: "Synthetic Saga",
      legacyImdbId: "tt1234568",
      priorViewed: false,
      rating: null,
      sourceRow: 3,
      submittedAt: "2026-08-02T10:30:00.000Z",
      title: "Synthetic Movie Two",
    },
  ],
  schemaVersion: 2,
  validated: true,
};

const worker = exports.default;

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
    const franchises = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM franchises",
    ).first<{ count: number }>();
    const ratingCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ratings",
    ).first<{ count: number }>();

    expect({
      franchises: franchises?.count,
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

  it("leaves external identity and franchise order unconfirmed", async () => {
    await importSyntheticCatalog();
    const tmdbLinkCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movies WHERE tmdb_id IS NOT NULL",
    ).first<{ count: number }>();
    const franchise = await env.DB.prepare(
      "SELECT order_confirmed FROM franchises",
    ).first<{ order_confirmed: number }>();

    expect(tmdbLinkCount?.count).toBe(0);
    expect(franchise?.order_confirmed).toBe(0);
  });

  it("restores the active franchise selection without fabricated roll history", async () => {
    await importSyntheticCatalog(2);
    const current = await env.DB.prepare(
      `SELECT now_showing.rolled_movie_id, now_showing.rolled_at,
              now_showing.status, movies.title, franchises.name AS franchise_name
       FROM now_showing
       LEFT JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN franchises ON franchises.id = now_showing.franchise_id
       WHERE now_showing.id = 1`,
    ).first();
    const rollCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rolls",
    ).first<{ count: number }>();
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log",
    ).first<{ count: number }>();

    expect(current).toEqual({
      franchise_name: "Synthetic Saga",
      rolled_at: null,
      rolled_movie_id: null,
      status: "pending_order",
      title: "Synthetic Movie Two",
    });
    expect(rollCount?.count).toBe(0);
    expect(auditCount?.count).toBe(0);
  });

  it("confirms and rates a franchise selection with stable imported IDs", async () => {
    await importSyntheticCatalog();
    const members = await env.DB.prepare(
      `SELECT franchises.id AS franchise_id, movies.id,
              CASE WHEN ratings.id IS NULL THEN 0 ELSE 1 END AS watched
       FROM franchise_movies
       JOIN franchises ON franchises.id = franchise_movies.franchise_id
       JOIN movies ON movies.id = franchise_movies.movie_id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       ORDER BY franchise_movies.position`,
    ).all<{ franchise_id: string; id: string; watched: number }>();
    const franchiseId = members.results[0]?.franchise_id;
    const unwatchedId = members.results.find((movie) => !movie.watched)?.id;

    expect(franchiseId).toMatch(/^franchise_/);
    expect(members.results.map((movie) => movie.id)).toEqual([
      expect.stringMatching(/^movie_/),
      expect.stringMatching(/^movie_/),
    ]);
    expect(unwatchedId).toEqual(expect.stringMatching(/^movie_/));

    const ordered = await request<{
      nowShowing: { movie_id: string; status: string };
    }>(`/api/franchises/${franchiseId}/order`, {
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
