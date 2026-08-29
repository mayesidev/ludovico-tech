import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  buildCatalogImportPlan,
  CATALOG_IMPORT_ATTRIBUTION,
  parseCatalogCsv,
  renderSqlChunks,
} from "../../scripts/catalog-import-lib";

const importedAt = "2026-08-25T12:00:00.000Z";
const source = `title,added_at,rating_score,rating_phrase,collection,collection_position,tmdb_id
Synthetic Movie One,2026-08-01T10:30:00.000Z,4.5,A synthetic delight,Synthetic Saga,1,
Synthetic Movie Two,,,,Synthetic Saga,2,42
`;

const importCatalog = async (csv: string) => {
  const parsed = parseCatalogCsv(csv);
  expect(parsed.diagnostics).toEqual([]);
  const plan = buildCatalogImportPlan(
    parsed.movies,
    parsed.nowShowingTitle,
    importedAt,
  );
  for (const sql of renderSqlChunks(plan.statements, 3)) {
    await env.DB.exec(sql);
  }
  return plan;
};

const importSyntheticCatalog = () => importCatalog(source);

describe("catalog import", () => {
  it("writes only durable catalog state", async () => {
    const plan = await importSyntheticCatalog();
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM movies) AS movies,
         (SELECT COUNT(*) FROM collections) AS collections,
         (SELECT COUNT(*) FROM collection_movies) AS collection_memberships,
         (SELECT COUNT(*) FROM ratings) AS ratings,
         (SELECT COUNT(*) FROM movie_tmdb_data) AS tmdb_links`,
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
        recorded_at: null,
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

  it("attributes import writes without inventing originating humans", async () => {
    await importSyntheticCatalog();
    const rows = await env.DB.prepare(
      `SELECT movies.title, movies.added_by, movies.updated_by,
              collections.created_by,
              collections.updated_by AS collection_updated_by,
              ratings.recorded_by,
              movie_tmdb_data.updated_by AS tmdb_updated_by
       FROM movies
       LEFT JOIN collection_movies
         ON collection_movies.movie_id = movies.id
       LEFT JOIN collections
         ON collections.id = collection_movies.collection_id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       LEFT JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
       ORDER BY movies.title`,
    ).all();

    expect(rows.results).toEqual([
      {
        added_by: null,
        collection_updated_by: CATALOG_IMPORT_ATTRIBUTION,
        created_by: null,
        recorded_by: null,
        title: "Synthetic Movie One",
        tmdb_updated_by: null,
        updated_by: CATALOG_IMPORT_ATTRIBUTION,
      },
      {
        added_by: null,
        collection_updated_by: CATALOG_IMPORT_ATTRIBUTION,
        created_by: null,
        recorded_by: null,
        title: "Synthetic Movie Two",
        tmdb_updated_by: CATALOG_IMPORT_ATTRIBUTION,
        updated_by: CATALOG_IMPORT_ATTRIBUTION,
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

  it("leaves Now Showing empty when no title is selected", async () => {
    await importSyntheticCatalog();
    const state = await env.DB.prepare(
      `SELECT now_showing.movie_id, now_showing.rolled_at, now_showing.rolled_by
       FROM now_showing WHERE id = 1`,
    ).first();
    expect(state).toEqual({
      movie_id: null,
      rolled_at: null,
      rolled_by: null,
    });
  });

  it("sets an imported unwatched title as Now Showing without creating history", async () => {
    await importCatalog(`title,collection,collection_position,now_showing
First Movie,Synthetic Saga,1,false
Starting Movie,Synthetic Saga,2,true
`);
    const state = await env.DB.prepare(
      `SELECT movies.title, collections.name AS collection_name,
              now_showing.rolled_at, now_showing.rolled_by
       FROM now_showing
       JOIN movies ON movies.id = now_showing.movie_id
       LEFT JOIN collection_movies ON collection_movies.movie_id = now_showing.movie_id
       LEFT JOIN collections ON collections.id = collection_movies.collection_id
       WHERE now_showing.id = 1`,
    ).first();

    expect(state).toEqual({
      collection_name: "Synthetic Saga",
      rolled_at: null,
      rolled_by: null,
      title: "Starting Movie",
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
