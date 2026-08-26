import { describe, expect, it } from "vitest";
import {
  buildCatalogImportPlan,
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
    expect(parsed.seed).toEqual({
      movies: [
        {
          addedAt: null,
          collection: null,
          collectionPosition: null,
          rating: null,
          title: "Synthetic Movie",
          tmdbId: null,
        },
      ],
      schemaVersion: 1,
    });

    const plan = await buildCatalogImportPlan(parsed.seed, importedAt);
    expect(plan.counts).toEqual({
      collectionMemberships: 0,
      collections: 0,
      movies: 1,
      ratings: 0,
      tmdbLinks: 0,
    });
    expect(plan.statements.join("\n")).toContain(importedAt);
    expect(plan.statements.join("\n")).not.toMatch(
      /movie_import_sources|prior_viewed|now_showing/,
    );
  });

  it("accepts only app-owned seed data and creates a bare TMDB link", async () => {
    const parsed = parseCatalogCsv(
      `${fullHeader}\nSynthetic Movie,2026-08-01T10:30:00.000Z,4.5,A synthetic delight,Synthetic Saga,1,42\n`,
    );
    expect(parsed.diagnostics).toEqual([]);

    const plan = await buildCatalogImportPlan(parsed.seed, importedAt);
    const sql = plan.statements.join("\n");
    expect(plan.counts).toEqual({
      collectionMemberships: 1,
      collections: 1,
      movies: 1,
      ratings: 1,
      tmdbLinks: 1,
    });
    expect(sql).toContain("INSERT OR IGNORE INTO movie_tmdb_data");
    expect(sql).toContain("(movie_id, tmdb_id, refresh_after)");
    expect(sql).toContain("'1970-01-01T00:00:00.000Z'");
    expect(sql).not.toMatch(
      /poster_path|runtime_minutes|tmdb_collections|tmdb_people|movie_credits|fetched_at|contract_id/,
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
      `${fullHeader}\nMovie One,not-a-date,4,,Saga,,not-an-id\nMovie Two,,,Phrase,,2,\n`,
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

  it("plans deterministic IDs and relationships independent of row layout", async () => {
    const first = parseCatalogCsv(
      "title,collection\nSecond Movie,Saga\nFirst Movie,Saga\n",
    );
    const second = parseCatalogCsv(
      "title,collection\nFirst Movie,Saga\nSecond Movie,Saga\n",
    );
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);

    const firstPlan = await buildCatalogImportPlan(first.seed, importedAt);
    const secondPlan = await buildCatalogImportPlan(second.seed, importedAt);
    expect(firstPlan).toEqual(secondPlan);
  });
});

describe("catalog import SQL chunks", () => {
  it("renders deterministic bounded chunks", () => {
    expect(renderSqlChunks(["SELECT 1;", "SELECT 2;"], 1)).toEqual([
      {
        filename: "chunk-0001.sql",
        sql: "PRAGMA foreign_keys = ON;\nSELECT 1;\n",
      },
      {
        filename: "chunk-0002.sql",
        sql: "PRAGMA foreign_keys = ON;\nSELECT 2;\n",
      },
    ]);
    expect(() => renderSqlChunks([], 0)).toThrow(
      "Chunk size must be a positive integer",
    );
  });
});
