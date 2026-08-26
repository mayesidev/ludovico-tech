import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  buildCatalogImportPlan,
  parseCatalogCsv,
  renderSqlChunks,
} from "../../scripts/catalog-import-lib";

const importedAt = "2026-08-25T12:00:00.000Z";
const source = `title,added_at,rating_score,rating_phrase,collection,collection_position,tmdb_id
Synthetic Movie One,2026-08-01T10:30:00.000Z,4.5,A synthetic delight,Synthetic Saga,1,
Synthetic Movie Two,,,,Synthetic Saga,2,42
`;

const importSyntheticCatalog = async (executions = 1) => {
  const parsed = parseCatalogCsv(source);
  expect(parsed.diagnostics).toEqual([]);
  const plan = await buildCatalogImportPlan(parsed.seed, importedAt);
  for (let execution = 0; execution < executions; execution += 1) {
    for (const chunk of renderSqlChunks(plan.statements, 3)) {
      await env.DB.exec(chunk.sql);
    }
  }
  return plan;
};

describe("catalog import", () => {
  it("writes only durable catalog state and is idempotent", async () => {
    const plan = await importSyntheticCatalog(2);
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM movies) AS movies,
         (SELECT COUNT(*) FROM collections) AS collections,
         (SELECT COUNT(*) FROM collection_movies) AS collection_memberships,
         (SELECT COUNT(*) FROM ratings) AS ratings,
         (SELECT COUNT(*) FROM movie_tmdb_data) AS tmdb_links,
         (SELECT COUNT(*) FROM movie_import_sources) AS obsolete_sources`,
    ).first();

    expect(plan.counts).toEqual({
      collectionMemberships: 2,
      collections: 1,
      movies: 2,
      ratings: 1,
      tmdbLinks: 1,
    });
    expect(counts).toEqual({
      collection_memberships: 2,
      collections: 1,
      movies: 2,
      obsolete_sources: 0,
      ratings: 1,
      tmdb_links: 1,
    });
  });

  it("defaults only the import-owned timestamps", async () => {
    await importSyntheticCatalog();
    const rows = await env.DB.prepare(
      `SELECT movies.title, movies.added_at, ratings.recorded_at,
              ratings.watched_at
       FROM movies
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       ORDER BY movies.title`,
    ).all();

    expect(rows.results).toEqual([
      {
        added_at: "2026-08-01T10:30:00.000Z",
        recorded_at: importedAt,
        title: "Synthetic Movie One",
        watched_at: null,
      },
      {
        added_at: importedAt,
        recorded_at: null,
        title: "Synthetic Movie Two",
        watched_at: null,
      },
    ]);
  });

  it("queues TMDB backfill without importing provider data", async () => {
    await importSyntheticCatalog();
    const link = await env.DB.prepare(
      `SELECT movie_tmdb_data.tmdb_id, movie_tmdb_data.title,
              movie_tmdb_data.release_date, movie_tmdb_data.poster_path,
              movie_tmdb_data.runtime_minutes,
              movie_tmdb_data.tmdb_collection_id,
              movie_tmdb_data.fetched_at, movie_tmdb_data.refresh_after,
              movie_tmdb_data.contract_id
       FROM movie_tmdb_data`,
    ).first();
    const providerRows = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM tmdb_people) AS people,
         (SELECT COUNT(*) FROM tmdb_collections) AS collections,
         (SELECT COUNT(*) FROM movie_credits) AS credits`,
    ).first();

    expect(link).toEqual({
      contract_id: null,
      fetched_at: null,
      poster_path: null,
      refresh_after: "1970-01-01T00:00:00.000Z",
      release_date: null,
      runtime_minutes: null,
      title: null,
      tmdb_collection_id: null,
      tmdb_id: 42,
    });
    expect(providerRows).toEqual({ collections: 0, credits: 0, people: 0 });
  });

  it("leaves selection and history to the application", async () => {
    await importSyntheticCatalog();
    const state = await env.DB.prepare(
      `SELECT now_showing.status,
              (SELECT COUNT(*) FROM rolls) AS rolls,
              (SELECT COUNT(*) FROM audit_log) AS audit_entries
       FROM now_showing WHERE id = 1`,
    ).first();
    expect(state).toEqual({
      audit_entries: 0,
      rolls: 0,
      status: "empty",
    });
  });

  it("exposes rating existence as watched state", async () => {
    await importSyntheticCatalog();
    const response = await exports.default.fetch(
      new Request("https://ludovico-tech.test/api/library"),
    );
    const body = (await response.json()) as {
      movies: Array<{ rating_score: number | null; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(
      body.movies.map((movie) => ({
        title: movie.title,
        watched: movie.rating_score !== null,
      })),
    ).toEqual([
      { title: "Synthetic Movie One", watched: true },
      { title: "Synthetic Movie Two", watched: false },
    ]);
  });
});
