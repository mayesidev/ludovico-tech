import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  parseImportCorrectionsJson,
  parseIntermediateJson,
  renderSqlChunks,
  sanitizeSourceCsv,
  type GeneralizedImportDocument,
  type GeneralizedSubmission,
} from "./import-sheet-lib";

const header = "opaque-a,opaque-b,opaque-c,opaque-d,opaque-e,opaque-f,opaque-g";

const submission = (
  overrides: Partial<GeneralizedSubmission> = {},
): GeneralizedSubmission => ({
  franchiseIndicated: false,
  franchiseName: null,
  legacyImdbId: null,
  priorViewed: false,
  rating: null,
  sourceRow: 2,
  submittedAt: "2026-08-01T10:30:00.000Z",
  title: "Synthetic Movie",
  ...overrides,
});

const document = (
  rows: GeneralizedSubmission[],
): GeneralizedImportDocument => ({
  rows,
  schemaVersion: 1,
  validated: true,
});

describe("private Sheet sanitization", () => {
  it("maps source columns by position without retaining headings", () => {
    const source = `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,Yes,Synthetic Saga,https://www.imdb.com/title/tt1234567/,4.5 A synthetic delight\n`;
    const result = sanitizeSourceCsv(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toEqual({
      rows: [
        {
          franchiseIndicated: true,
          franchiseName: "Synthetic Saga",
          legacyImdbId: "tt1234567",
          priorViewed: false,
          rating: { phrase: "A synthetic delight", score: 4.5 },
          sourceRow: 2,
          submittedAt: "2026-08-01T10:30:00.000Z",
          title: "Synthetic Movie",
        },
      ],
      schemaVersion: 1,
      validated: true,
    });
    expect(JSON.stringify(result)).not.toContain("opaque-a");
  });

  it("reports only generalized row codes for invalid private values", () => {
    const source = `${header}\n8/1/2026 10:30:00,Synthetic Movie,PRIVATE_VALUE_MARKER,PRIVATE_INDICATOR_MARKER,,PRIVATE_REFERENCE,PRIVATE_RATING\n`;
    const result = sanitizeSourceCsv(source);
    const serializedDiagnostics = JSON.stringify(result.diagnostics);

    expect(result.document.validated).toBe(false);
    expect(result.diagnostics).toEqual([
      { code: "INVALID_PRIOR_VIEWED", row: 2, severity: "error" },
      {
        code: "INVALID_FRANCHISE_INDICATOR",
        row: 2,
        severity: "error",
      },
      { code: "INVALID_RATING", row: 2, severity: "error" },
      { code: "INVALID_IMDB_REFERENCE", row: 2, severity: "warning" },
    ]);
    expect(serializedDiagnostics).not.toContain("PRIVATE");
  });

  it("reports franchise indicator disagreement without changing membership", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,Synthetic Saga,,\n`,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows[0].franchiseName).toBe("Synthetic Saga");
    expect(result.diagnostics).toEqual([
      {
        code: "FRANCHISE_INDICATOR_MISMATCH",
        row: 2,
        severity: "warning",
      },
    ]);
  });

  it("retains uncertain franchise indicators as a review warning", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,Maybe,Synthetic Saga,,\n`,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows[0].franchiseIndicated).toBeNull();
    expect(result.diagnostics).toEqual([
      {
        code: "FRANCHISE_INDICATOR_UNCERTAIN",
        row: 2,
        severity: "warning",
      },
    ]);
  });

  it("accepts a strict score after its required rating phrase", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,A synthetic delight 4.5\n`,
    );

    expect(result.document.rows[0].rating).toEqual({
      phrase: "A synthetic delight",
      score: 4.5,
    });
  });

  it("applies reviewed row-only corrections only to invalid ratings", () => {
    const corrections = parseImportCorrectionsJson(
      JSON.stringify({
        excludedSourceRows: [],
        legacyImdbIds: [],
        ratings: [
          { score: 4, sourceRow: 2 },
          {
            phrase: "Five synthetic marks",
            score: 5,
            sourceRow: 3,
          },
        ],
        schemaVersion: 1,
      }),
    );
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,First Synthetic Movie,No,No,,,Wordplay phrase\n8/2/2026 10:30:00,Second Synthetic Movie,No,No,,,Other wordplay\n`,
      corrections!,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows.map((row) => row.rating)).toEqual([
      { phrase: "Wordplay phrase", score: 4 },
      { phrase: "Five synthetic marks", score: 5 },
    ]);
  });

  it("rejects malformed, duplicate, and unused correction records", () => {
    expect(
      parseImportCorrectionsJson(
        JSON.stringify({
          excludedSourceRows: [],
          legacyImdbIds: [],
          ratings: [
            { score: 4, sourceRow: 2 },
            { score: 5, sourceRow: 2 },
          ],
          schemaVersion: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseImportCorrectionsJson(
        JSON.stringify({
          excludedSourceRows: [],
          legacyImdbIds: [],
          ratings: [{ score: 4.25, sourceRow: 2 }],
          schemaVersion: 1,
        }),
      ),
    ).toBeNull();

    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,4 Valid phrase\n`,
      {
        excludedSourceRows: new Set(),
        legacyImdbIds: new Map(),
        ratings: new Map([[2, { score: 4 }]]),
      },
    );
    expect(result.document.validated).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "RATING_CORRECTION_UNUSED",
      row: 2,
      severity: "error",
    });
  });

  it("applies reviewed external-ID corrections without exposing source values", () => {
    const corrections = parseImportCorrectionsJson(
      JSON.stringify({
        excludedSourceRows: [],
        legacyImdbIds: [{ id: "tt123456", sourceRow: 2 }],
        ratings: [],
        schemaVersion: 1,
      }),
    );
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,https://www.imdb.com/title/tt9999999/,\n`,
      corrections!,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows[0].legacyImdbId).toBe("tt123456");
    expect(JSON.stringify(result.diagnostics)).not.toContain("tt");
  });

  it("applies an explicit reviewed source-row exclusion", () => {
    const corrections = parseImportCorrectionsJson(
      JSON.stringify({
        excludedSourceRows: [3],
        legacyImdbIds: [],
        ratings: [],
        schemaVersion: 1,
      }),
    );
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Retained Synthetic Movie,No,No,,,\n8/2/2026 10:30:00,Dropped Synthetic Movie,No,No,,,\n`,
      corrections!,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows.map((row) => row.sourceRow)).toEqual([2]);
    expect(result.diagnostics).toEqual([
      { code: "SOURCE_ROW_EXCLUDED", row: 3, severity: "warning" },
    ]);
  });

  it("rejects duplicate and unknown source-row exclusions", () => {
    expect(
      parseImportCorrectionsJson(
        JSON.stringify({
          excludedSourceRows: [3, 3],
          legacyImdbIds: [],
          ratings: [],
          schemaVersion: 1,
        }),
      ),
    ).toBeNull();

    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,\n`,
      {
        excludedSourceRows: new Set([3]),
        legacyImdbIds: new Map(),
        ratings: new Map(),
      },
    );
    expect(result.document.validated).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: "SOURCE_ROW_EXCLUSION_UNUSED",
        row: 3,
        severity: "error",
      },
    ]);
  });

  it("rejects malformed CSV without propagating parser details", () => {
    expect(sanitizeSourceCsv('"unterminated').diagnostics).toEqual([
      { code: "SOURCE_CSV_INVALID", row: null, severity: "error" },
    ]);
  });
});

describe("deterministic import planning", () => {
  it("deduplicates exact submissions but keeps their provenance", async () => {
    const first = submission();
    const second = { ...first, sourceRow: 3 };
    const plan = await buildImportPlan(
      document([first, second]),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.counts).toEqual({
      franchises: 0,
      movies: 1,
      ratings: 0,
      sources: 2,
    });
    expect(
      plan.statements.filter((statement) =>
        statement.includes("movie_import_sources"),
      ),
    ).toHaveLength(2);
  });

  it("keeps same-title works distinct without an IMDb identity", async () => {
    const plan = await buildImportPlan(
      document([
        submission(),
        submission({
          sourceRow: 3,
          submittedAt: "2026-08-02T10:30:00.000Z",
        }),
      ]),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.counts.movies).toBe(2);
  });

  it("uses IMDb identity for deduplication and preserves one shared rating", async () => {
    const plan = await buildImportPlan(
      document([
        submission({ legacyImdbId: "tt1234567" }),
        submission({
          legacyImdbId: "tt1234567",
          rating: { phrase: "Synthetic phrase", score: 4 },
          sourceRow: 3,
        }),
      ]),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.counts).toEqual({
      franchises: 0,
      movies: 1,
      ratings: 1,
      sources: 2,
    });
  });

  it("keeps submitted canonical data distinct when an external ID conflicts", async () => {
    const plan = await buildImportPlan(
      document([
        submission({ legacyImdbId: "tt1234567" }),
        submission({
          franchiseIndicated: true,
          franchiseName: "Distinct Synthetic Saga",
          legacyImdbId: "tt1234567",
          sourceRow: 3,
          title: "Conflicting Synthetic Movie",
        }),
      ]),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.counts.movies).toBe(2);
    expect(plan.diagnostics).toEqual([
      { code: "DUPLICATE_EXTERNAL_ID", row: 2, severity: "warning" },
      { code: "DUPLICATE_EXTERNAL_ID", row: 3, severity: "warning" },
    ]);
    expect(plan.statements.join("\n")).not.toContain("tt1234567");
  });

  it("stops duplicate generalized source-row identities", async () => {
    const plan = await buildImportPlan(
      document([
        submission(),
        submission({ title: "Another Synthetic Movie" }),
      ]),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.statements).toEqual([]);
    expect(plan.diagnostics).toEqual([
      { code: "DUPLICATE_SOURCE_ROW", row: 2, severity: "error" },
    ]);
  });

  it("produces identical SQL for identical validated input", async () => {
    const input = document([
      submission({
        franchiseIndicated: true,
        franchiseName: "Synthetic Saga",
        rating: { phrase: "Director's choice", score: 5 },
      }),
    ]);
    const importedAt = "2026-08-06T20:00:00.000Z";

    const first = await buildImportPlan(input, importedAt);
    const second = await buildImportPlan(input, importedAt);
    expect(second).toEqual(first);
    expect(first.statements.join("\n")).toContain("Director''s choice");
  });

  it("includes the final statement in generated chunks", () => {
    const chunks = renderSqlChunks(["one;", "two;", "final;"], 2);

    expect(chunks.map((chunk) => chunk.filename)).toEqual([
      "chunk-0001.sql",
      "chunk-0002.sql",
    ]);
    expect(chunks[1].sql).toContain("final;");
    expect(chunks[1].sql).toMatch(/final;\n$/);
  });

  it("accepts only validated generalized intermediate JSON", () => {
    const valid = document([submission({ legacyImdbId: "tt123456" })]);
    expect(parseIntermediateJson(JSON.stringify(valid))).toEqual(valid);
    expect(
      parseIntermediateJson(JSON.stringify({ ...valid, validated: false })),
    ).toBeNull();
    expect(
      parseIntermediateJson(
        JSON.stringify({ ...valid, privateHeading: "must not propagate" }),
      ),
    ).toBeNull();
  });
});
