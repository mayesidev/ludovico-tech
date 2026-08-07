import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  renderSqlChunks,
  type GeneralizedImportDocument,
} from "../../scripts/import-sheet-lib";

describe("generalized catalog import", () => {
  it("executes every generated chunk and is idempotent", async () => {
    const document: GeneralizedImportDocument = {
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
      schemaVersion: 1,
      validated: true,
    };
    const plan = await buildImportPlan(document, "2026-08-06T20:00:00.000Z");
    const chunks = renderSqlChunks(plan.statements, 3);

    for (const chunk of chunks) await env.DB.exec(chunk.sql);
    for (const chunk of chunks) await env.DB.exec(chunk.sql);

    const movies = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movies",
    ).first<{ count: number }>();
    const sources = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movie_import_sources",
    ).first<{ count: number }>();
    const ratings = await env.DB.prepare(
      "SELECT score, phrase, watched_at FROM ratings",
    ).first<{ phrase: string; score: number; watched_at: string | null }>();
    const franchise = await env.DB.prepare(
      "SELECT order_confirmed FROM franchises",
    ).first<{ order_confirmed: number }>();

    expect(movies?.count).toBe(2);
    expect(sources?.count).toBe(2);
    expect(ratings).toEqual({
      phrase: "A synthetic delight",
      score: 4.5,
      watched_at: null,
    });
    expect(franchise?.order_confirmed).toBe(0);
  });
});
