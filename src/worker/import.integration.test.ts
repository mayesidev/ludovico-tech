import { env } from "cloudflare:workers";
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
});
