import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";
import { movieSelect } from "./db";

const queryPlan = async (sql: string, bindings: Array<string | number> = []) =>
  (
    await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...bindings)
      .all<{ detail: string }>()
  ).results.map(({ detail }) => detail);

describe("D1 index alignment", () => {
  it("removes only redundant or unreferenced explicit indexes", async () => {
    const explicitIndexes = (
      await env.DB.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND sql IS NOT NULL
         ORDER BY name`,
      ).all<{ name: string }>()
    ).results.map(({ name }) => name);

    expect(explicitIndexes).not.toContain("idx_collection_movies_order");
    expect(explicitIndexes).not.toContain("idx_movies_title_normalized");
    expect(explicitIndexes).not.toContain("idx_ratings_recorded_at");
    expect(explicitIndexes).toEqual(
      expect.arrayContaining([
        "idx_auth_sessions_expires_at",
        "idx_movie_credits_person",
        "idx_movie_import_sources_movie",
        "idx_movie_tmdb_data_collection",
        "idx_movie_tmdb_data_due_queue",
        "idx_movie_tmdb_data_refresh",
        "idx_movies_title_nocase",
        "idx_oauth_states_expires_at",
        "idx_ratings_watched_history",
        "idx_tmdb_cache_expires_at",
      ]),
    );
  });

  it("uses the collection uniqueness index for ordered membership reads", async () => {
    const plan = await queryPlan(
      `SELECT movie_id, position FROM collection_movies
       WHERE collection_id = ? ORDER BY position`,
      ["collection-id"],
    );

    expect(plan).toContain(
      "SEARCH collection_movies USING INDEX sqlite_autoindex_collection_movies_3 (collection_id=?)",
    );
    expect(plan.some((detail) => detail.includes("TEMP B-TREE"))).toBe(false);
  });

  it("uses the unique IMDb lookup and indexes imported rows for cascades", async () => {
    const plan = await queryPlan(
      `SELECT id FROM movies
       WHERE imdb_id = ? AND title_normalized = ? LIMIT 1`,
      ["tt0000001", "normalized title"],
    );

    expect(plan).toContain(
      "SEARCH movies USING INDEX sqlite_autoindex_movies_2 (imdb_id=?)",
    );
    expect(plan.some((detail) => detail.startsWith("SCAN "))).toBe(false);

    const importIndex = (
      await env.DB.prepare(
        "PRAGMA index_info(idx_movie_import_sources_movie)",
      ).all<{ name: string }>()
    ).results.map(({ name }) => name);
    const importForeignKeys = (
      await env.DB.prepare(
        "PRAGMA foreign_key_list(movie_import_sources)",
      ).all<{ from: string; on_delete: string; table: string }>()
    ).results;
    expect(importIndex).toEqual(["movie_id"]);
    expect(importForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "movie_id",
          on_delete: "CASCADE",
          table: "movies",
        }),
      ]),
    );
  });

  it("searches selective expiry, cleanup, and catalog paths", async () => {
    const plans = await Promise.all([
      queryPlan("DELETE FROM auth_sessions WHERE expires_at <= ?", [
        "2026-08-24T00:00:00.000Z",
      ]),
      queryPlan("DELETE FROM oauth_states WHERE expires_at <= ?", [
        "2026-08-24T00:00:00.000Z",
      ]),
      queryPlan("DELETE FROM tmdb_cache WHERE expires_at <= ?", [
        "2026-08-24T00:00:00.000Z",
      ]),
      queryPlan(
        `DELETE FROM tmdb_people
         WHERE tmdb_id IN (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM movie_credits
             WHERE movie_credits.tmdb_person_id = tmdb_people.tmdb_id
           )`,
        [1, 2],
      ),
      queryPlan(
        `DELETE FROM tmdb_collections
         WHERE tmdb_id IN (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM movie_tmdb_data
             WHERE movie_tmdb_data.tmdb_collection_id = tmdb_collections.tmdb_id
           )`,
        [1, 2],
      ),
    ]);
    const details = plans.flat();

    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("idx_auth_sessions_expires_at"),
        expect.stringContaining("idx_oauth_states_expires_at"),
        expect.stringContaining("idx_tmdb_cache_expires_at"),
        expect.stringContaining("idx_movie_credits_person"),
        expect.stringContaining("idx_movie_tmdb_data_collection"),
      ]),
    );
    expect(details.filter((detail) => detail.startsWith("SCAN "))).toEqual([]);
  });

  it("uses keyed searches for movie detail and credit reads", async () => {
    const detailPlan = await queryPlan(`${movieSelect} WHERE movies.id = ?`, [
      "movie-id",
    ]);
    const creditsPlan = await queryPlan(
      `SELECT movie_credits.credit_type, tmdb_people.tmdb_id,
              tmdb_people.name
       FROM movie_credits
       JOIN tmdb_people
         ON tmdb_people.tmdb_id = movie_credits.tmdb_person_id
       WHERE movie_credits.movie_id = ?
       ORDER BY movie_credits.credit_type, movie_credits.position`,
      ["movie-id"],
    );

    expect(
      [...detailPlan, ...creditsPlan].filter((detail) =>
        detail.startsWith("SCAN "),
      ),
    ).toEqual([]);
    expect(creditsPlan).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SEARCH movie_credits USING INDEX sqlite_autoindex_movie_credits_1 (movie_id=?)",
        ),
        expect.stringContaining("SEARCH tmdb_people USING INTEGER PRIMARY KEY"),
      ]),
    );
  });

  it("uses rowid and watched-history indexes for bounded random and history reads", async () => {
    const randomPlan = await queryPlan(
      `SELECT movies.id, movies.title, collection_movies.collection_id
       FROM movies
       LEFT JOIN collection_movies
         ON collection_movies.movie_id = movies.id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       WHERE ratings.id IS NULL AND movies.rowid >= ?
       ORDER BY movies.rowid ASC LIMIT 1`,
      [1],
    );
    const historyPlan = await queryPlan(
      `SELECT movies.id
       FROM ratings
       JOIN movies ON movies.id = ratings.movie_id
       WHERE ratings.watched_at IS NOT NULL
       ORDER BY ratings.watched_at DESC, ratings.movie_id ASC
       LIMIT 1`,
    );

    expect(randomPlan).toContain(
      "SEARCH movies USING INTEGER PRIMARY KEY (rowid>?)",
    );
    expect(historyPlan).toContain(
      "SEARCH ratings USING COVERING INDEX idx_ratings_watched_history (watched_at>?)",
    );
    expect(
      [...randomPlan, ...historyPlan].some((detail) =>
        detail.includes("TEMP B-TREE"),
      ),
    ).toBe(false);
  });

  it("materializes only the requested Library IDs before hydrating joins", async () => {
    const plan = await queryPlan(
      `WITH page AS MATERIALIZED (
         SELECT movies.id
         FROM movies
         ORDER BY movies.title COLLATE NOCASE ASC, movies.id ASC
         LIMIT ? OFFSET ?
       )
       ${movieSelect}
       WHERE movies.id IN (SELECT id FROM page)
       ORDER BY movies.title COLLATE NOCASE ASC, movies.id ASC`,
      [25, 0],
    );

    expect(plan).toContain("MATERIALIZE page");
    expect(plan).toContain(
      "SCAN movies USING COVERING INDEX idx_movies_title_nocase",
    );
    expect(plan.filter((detail) => detail.startsWith("SCAN "))).toEqual([
      "SCAN movies USING COVERING INDEX idx_movies_title_nocase",
      "SCAN page",
    ]);
  });

  it("uses index searches for selective steady-state refresh counts", async () => {
    const contractId = await getTmdbMetadataContractId();
    const plan = await queryPlan(
      `SELECT COUNT(*) FROM movie_tmdb_data
       WHERE contract_id IS NULL
          OR contract_id < ?
          OR contract_id > ?
          OR (contract_id = ? AND refresh_after <= ?)`,
      [contractId, contractId, contractId, "2026-08-24T00:00:00.000Z"],
    );

    expect(plan[0]).toBe("MULTI-INDEX OR");
    expect(
      plan.filter((detail) =>
        detail.includes(
          "SEARCH movie_tmdb_data USING COVERING INDEX idx_movie_tmdb_data_refresh",
        ),
      ),
    ).toHaveLength(4);
    expect(plan.some((detail) => detail.startsWith("SCAN "))).toBe(false);
  });

  it("retains intentional covering scans for complete ordered sets", async () => {
    const titlePlan = await queryPlan(
      `SELECT id FROM movies
       ORDER BY title COLLATE NOCASE, id LIMIT 25`,
    );
    const duePlan = await queryPlan(
      `SELECT movie_id, tmdb_id FROM movie_tmdb_data
       WHERE refresh_after <= ? OR contract_id IS NULL OR contract_id <> ?
       ORDER BY refresh_after, movie_id LIMIT 25`,
      ["2026-08-24T00:00:00.000Z", await getTmdbMetadataContractId()],
    );

    expect(titlePlan).toContain(
      "SCAN movies USING COVERING INDEX idx_movies_title_nocase",
    );
    expect(duePlan).toContain(
      "SCAN movie_tmdb_data USING COVERING INDEX idx_movie_tmdb_data_due_queue",
    );
    expect(
      [...titlePlan, ...duePlan].some((detail) =>
        detail.includes("TEMP B-TREE"),
      ),
    ).toBe(false);
  });
});
