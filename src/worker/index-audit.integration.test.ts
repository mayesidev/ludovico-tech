import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";

const queryPlan = async (sql: string, bindings: Array<string> = []) =>
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

  it("uses the unique IMDb lookup for legacy import matching", async () => {
    const plan = await queryPlan(
      `SELECT id FROM movies
       WHERE imdb_id = ? AND title_normalized = ? LIMIT 1`,
      ["tt0000001", "normalized title"],
    );

    expect(plan).toContain(
      "SEARCH movies USING INDEX sqlite_autoindex_movies_2 (imdb_id=?)",
    );
    expect(plan.some((detail) => detail.startsWith("SCAN "))).toBe(false);
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
        "SELECT source_key FROM movie_import_sources WHERE movie_id = ?",
        ["movie-id"],
      ),
      queryPlan(
        `SELECT tmdb_person_id FROM movie_credits
         WHERE tmdb_person_id = ?`,
        ["1"],
      ),
      queryPlan(
        `SELECT movie_id FROM movie_tmdb_data
         WHERE tmdb_collection_id = ?`,
        ["1"],
      ),
    ]);
    const details = plans.flat();

    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("idx_auth_sessions_expires_at"),
        expect.stringContaining("idx_oauth_states_expires_at"),
        expect.stringContaining("idx_tmdb_cache_expires_at"),
        expect.stringContaining("idx_movie_import_sources_movie"),
        expect.stringContaining("idx_movie_credits_person"),
        expect.stringContaining("idx_movie_tmdb_data_collection"),
      ]),
    );
    expect(details.filter((detail) => detail.startsWith("SCAN "))).toEqual([]);
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
    const historyPlan = await queryPlan(
      `SELECT movie_id FROM ratings
       WHERE watched_at IS NOT NULL
       ORDER BY watched_at DESC, movie_id LIMIT 4`,
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
    expect(historyPlan).toContain(
      "SEARCH ratings USING COVERING INDEX idx_ratings_watched_history (watched_at>?)",
    );
    expect(duePlan).toContain(
      "SCAN movie_tmdb_data USING COVERING INDEX idx_movie_tmdb_data_due_queue",
    );
    expect(
      [...titlePlan, ...historyPlan, ...duePlan].some((detail) =>
        detail.includes("TEMP B-TREE"),
      ),
    ).toBe(false);
  });
});
