import { describe, expect, it } from "vitest";
import {
  buildCatalogImportPlan,
  CATALOG_IMPORT_ACTOR,
  CATALOG_IMPORT_COLUMNS,
  parseCatalogCsv,
  renderSqlChunks,
} from "./catalog-import-lib";

const importedAt = "2026-08-25T12:00:00.000Z";
const fullHeader = CATALOG_IMPORT_COLUMNS.join(",");

describe("catalog import template", () => {
  it("accepts a title as the complete minimal row", async () => {
    const parsed = parseCatalogCsv("title\nSynthetic Movie\n");

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.movies).toEqual([
      {
        addedAt: null,
        addedByEmail: null,
        collection: null,
        collectionPosition: null,
        rating: null,
        title: "Synthetic Movie",
        tmdbId: null,
      },
    ]);

    expect(parsed.nowShowingTitle).toBeNull();
    const plan = buildCatalogImportPlan(
      parsed.movies,
      parsed.nowShowingTitle,
      importedAt,
    );
    expect(plan.counts).toEqual({
      collectionMemberships: 0,
      collections: 0,
      movies: 1,
      ratings: 0,
      tmdbLinks: 0,
    });
    expect(plan.statements.join("\n")).toContain(importedAt);
    expect(plan.statements.join("\n")).toContain(`'${CATALOG_IMPORT_ACTOR}'`);
    expect(plan.statements[0]).toMatch(
      /^INSERT INTO movies \(id, title, added_at, added_by, updated_at, updated_by\) VALUES /,
    );
    expect(plan.statements.join("\n")).not.toMatch(
      /movie_import_sources|prior_viewed|title_normalized|now_showing/,
    );
  });

  it("accepts supported import data and creates a bare TMDB link", async () => {
    const parsed = parseCatalogCsv(
      `${fullHeader}\nSynthetic Movie,2026-08-01T10:30:00.000Z,Adder@Example.test,4.5,A synthetic delight,Rater@Example.test,Synthetic Saga,1,42,false\n`,
    );
    expect(parsed.diagnostics).toEqual([]);

    const plan = buildCatalogImportPlan(
      parsed.movies,
      parsed.nowShowingTitle,
      importedAt,
    );
    const sql = plan.statements.join("\n");
    expect(plan.counts).toEqual({
      collectionMemberships: 1,
      collections: 1,
      movies: 1,
      ratings: 1,
      tmdbLinks: 1,
    });
    expect(sql).toContain("INSERT INTO movie_tmdb_data");
    expect(sql).toContain(
      "(movie_id, tmdb_id, refresh_after, updated_at, updated_by)",
    );
    expect(sql).toContain(
      "INSERT INTO ratings (movie_id, watched_at, score, phrase, recorded_at, recorded_by)",
    );
    expect(sql).toContain(
      "(SELECT id FROM users WHERE email = 'adder@example.test')",
    );
    expect(sql).toContain(
      "(SELECT id FROM users WHERE email = 'rater@example.test')",
    );
    expect(sql).toContain("'1970-01-01T00:00:00.000Z'");
    expect(sql).not.toMatch(
      /poster_path|runtime_minutes|tmdb_collections|tmdb_people|movie_credits|fetched_at|contract_id|legacy_import/,
    );
  });

  it("allows supported columns in any order and rejects unknown structure", () => {
    expect(
      parseCatalogCsv("tmdb_id,title\n42,Synthetic Movie\n").diagnostics,
    ).toEqual([]);
    expect(parseCatalogCsv("name\nSynthetic Movie\n").diagnostics).toEqual([
      { code: "TEMPLATE_UNKNOWN_COLUMN", row: 1, severity: "error" },
      { code: "TEMPLATE_MISSING_TITLE", row: 1, severity: "error" },
      { code: "INVALID_TITLE", row: 2, severity: "error" },
    ]);
    expect(
      parseCatalogCsv("title,title\nOne,Two\n").diagnostics,
    ).toContainEqual({
      code: "TEMPLATE_DUPLICATE_COLUMN",
      row: 1,
      severity: "error",
    });
  });

  it("rejects partial ratings and invalid optional values", () => {
    const parsed = parseCatalogCsv(
      `${fullHeader}\nMovie One,not-a-date,,4,,,Saga,,not-an-id,\nMovie Two,,,,Phrase,,,2,,\n`,
    );
    expect(parsed.diagnostics).toEqual([
      { code: "INVALID_ADDED_AT", row: 2, severity: "error" },
      { code: "INVALID_RATING", row: 2, severity: "error" },
      { code: "INVALID_TMDB_ID", row: 2, severity: "error" },
      { code: "INVALID_RATING", row: 3, severity: "error" },
      {
        code: "INVALID_COLLECTION_POSITION",
        row: 3,
        severity: "error",
      },
    ]);
  });

  it("rejects invalid or unpaired actor emails without exposing values", () => {
    const parsed = parseCatalogCsv(
      "title,added_by_email,rating_by_email\nMovie One,not-an-email,\nMovie Two,,rater@example.test\n",
    );
    expect(parsed.diagnostics).toEqual([
      { code: "INVALID_ADDED_BY_EMAIL", row: 2, severity: "error" },
      { code: "INVALID_RATING_BY_EMAIL", row: 3, severity: "error" },
    ]);
  });

  it("selects one imported unwatched movie as Now Showing", async () => {
    const parsed = parseCatalogCsv(
      "title,collection,collection_position,now_showing\nFirst Movie,Saga,1,false\nStarting Movie,Saga,2,true\n",
    );
    expect(parsed.diagnostics).toEqual([]);

    expect(parsed.nowShowingTitle).toBe("Starting Movie");
    const plan = buildCatalogImportPlan(
      parsed.movies,
      parsed.nowShowingTitle,
      importedAt,
    );
    expect(plan.nowShowing?.movieId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(plan.nowShowing?.collectionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(plan.statements.at(-1)).toBe(
      `UPDATE now_showing SET movie_id = '${plan.nowShowing?.movieId}', collection_id = '${plan.nowShowing?.collectionId}', status = 'ready', updated_at = '${importedAt}', updated_by = '${CATALOG_IMPORT_ACTOR}' WHERE id = 1;`,
    );
  });

  it("rejects invalid, multiple, or watched Now Showing selections", () => {
    expect(
      parseCatalogCsv("title,now_showing\nMovie One,yes\n").diagnostics,
    ).toEqual([{ code: "INVALID_NOW_SHOWING", row: 2, severity: "error" }]);

    expect(
      parseCatalogCsv(
        "title,rating_score,rating_phrase,now_showing\nMovie One,,,true\nMovie Two,4,Good,true\n",
      ).diagnostics,
    ).toEqual([
      { code: "MULTIPLE_NOW_SHOWING", row: 2, severity: "error" },
      { code: "MULTIPLE_NOW_SHOWING", row: 3, severity: "error" },
      { code: "WATCHED_NOW_SHOWING", row: 3, severity: "error" },
    ]);
  });

  it("rejects collection labels that cannot form application identity", () => {
    expect(
      parseCatalogCsv("title,collection\nSynthetic Movie,🎬\n").diagnostics,
    ).toEqual([{ code: "INVALID_COLLECTION", row: 2, severity: "error" }]);
  });

  it("rejects ambiguous catalog and provider identities", () => {
    const parsed = parseCatalogCsv(
      `title,tmdb_id\nMovie One,42\nMovie Two,43\nMóvie One,42\n`,
    );
    expect(parsed.diagnostics).toEqual([
      { code: "DUPLICATE_TITLE", row: 4, severity: "error" },
      { code: "DUPLICATE_TMDB_ID", row: 4, severity: "error" },
    ]);
  });

  it("requires complete contiguous collection order when positions are used", () => {
    const partial = parseCatalogCsv(
      "title,collection,collection_position\nOne,Saga,1\nTwo,Saga,\n",
    );
    expect(partial.diagnostics).toEqual([
      { code: "COLLECTION_ORDER_INCOMPLETE", row: 2, severity: "error" },
      { code: "COLLECTION_ORDER_INCOMPLETE", row: 3, severity: "error" },
    ]);

    const duplicate = parseCatalogCsv(
      "title,collection,collection_position\nOne,Saga,1\nTwo,Saga,1\n",
    );
    expect(duplicate.diagnostics).toContainEqual({
      code: "DUPLICATE_COLLECTION_POSITION",
      row: 3,
      severity: "error",
    });
    expect(duplicate.diagnostics).toContainEqual({
      code: "COLLECTION_ORDER_INCOMPLETE",
      row: 2,
      severity: "error",
    });
  });

  it("plans relationships in normalized title order", async () => {
    const first = parseCatalogCsv(
      "title,collection\nSecond Movie,Saga\nFirst Movie,Saga\n",
    );
    const second = parseCatalogCsv(
      "title,collection\nFirst Movie,Saga\nSecond Movie,Saga\n",
    );
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);

    const firstPlan = buildCatalogImportPlan(
      first.movies,
      first.nowShowingTitle,
      importedAt,
    );
    const secondPlan = buildCatalogImportPlan(
      second.movies,
      second.nowShowingTitle,
      importedAt,
    );
    for (const plan of [firstPlan, secondPlan]) {
      const movieInsert = plan.statements.find((statement) =>
        statement.startsWith("INSERT INTO movies "),
      ) as string;
      expect(movieInsert.indexOf("First Movie")).toBeLessThan(
        movieInsert.indexOf("Second Movie"),
      );
    }
  });
});

describe("catalog import SQL chunks", () => {
  it("renders deterministic bounded chunks", () => {
    expect(renderSqlChunks(["SELECT 1;", "SELECT 2;"], 1)).toEqual([
      "PRAGMA foreign_keys = ON;\nSELECT 1;\n",
      "PRAGMA foreign_keys = ON;\nSELECT 2;\n",
    ]);
    expect(() => renderSqlChunks([], 0)).toThrow(
      "Chunk size must be a positive integer",
    );
  });

  it("batches hundreds of rows into bounded multi-row inserts", async () => {
    const movies = Array.from({ length: 600 }, (_, index) => ({
      addedAt: null,
      addedByEmail: null,
      collection: "Synthetic Series",
      collectionPosition: index + 1,
      rating: { phrase: "Good", recordedByEmail: null, score: 4 },
      title: `Synthetic Movie ${String(index + 1).padStart(4, "0")}`,
      tmdbId: index + 1,
    }));

    const plan = buildCatalogImportPlan(movies, null, importedAt);
    for (const table of [
      "movies",
      "movie_tmdb_data",
      "collection_movies",
      "ratings",
    ]) {
      const inserts = plan.statements.filter((statement) =>
        statement.startsWith(`INSERT INTO ${table} `),
      );
      expect(inserts).toHaveLength(3);
      expect(
        inserts.map(
          (statement) =>
            statement.slice(statement.indexOf(" VALUES ") + 8).split("), (")
              .length,
        ),
      ).toEqual([250, 250, 100]);
      expect(
        inserts.every(
          (statement) =>
            new TextEncoder().encode(statement).byteLength < 100_000,
        ),
      ).toBe(true);
    }
  });
});
