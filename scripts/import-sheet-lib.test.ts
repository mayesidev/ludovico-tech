import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  buildTmdbMetadataPlan,
  parseImportCorrectionsJson,
  parseIntermediateJson,
  parseTmdbReconciliationJson,
  renderSqlChunks,
  sanitizeSourceCsv,
  type GeneralizedImportDocument,
  type GeneralizedSubmission,
  type TmdbReconciliationDocument,
} from "./import-sheet-lib";

const header = "opaque-a,opaque-b,opaque-c,opaque-d,opaque-e,opaque-f,opaque-g";

const submission = (
  overrides: Partial<GeneralizedSubmission> = {},
): GeneralizedSubmission => ({
  collectionIndicated: false,
  collectionName: null,
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
  nowShowingSourceRow: number | null = null,
): GeneralizedImportDocument => ({
  nowShowingSourceRow,
  rows,
  schemaVersion: 3,
  validated: true,
});

const reconciliation = (
  overrides: Partial<TmdbReconciliationDocument> = {},
): TmdbReconciliationDocument => ({
  complete: true,
  generatedAt: "2026-08-10T10:00:00.000Z",
  matches: [
    {
      legacyImdbId: "tt1234567",
      posterPath: "/synthetic.jpg",
      providerTitleNormalized: "synthetic movie",
      releaseDate: "2024-01-02",
      runtimeMinutes: 123,
      sourceTitleNormalized: "synthetic movie",
      tmdbCollectionId: 7,
      tmdbCollectionName: "Synthetic Collection",
      tmdbId: 42,
    },
  ],
  schemaVersion: 3,
  ...overrides,
});

describe("private Sheet sanitization", () => {
  it("maps source columns by position without retaining headings", () => {
    const source = `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,Yes,Synthetic Saga,https://www.imdb.com/title/tt1234567/,4.5 A synthetic delight\n`;
    const result = sanitizeSourceCsv(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toEqual({
      nowShowingSourceRow: null,
      rows: [
        {
          collectionIndicated: true,
          collectionName: "Synthetic Saga",
          legacyImdbId: "tt1234567",
          priorViewed: false,
          rating: { phrase: "A synthetic delight", score: 4.5 },
          sourceRow: 2,
          submittedAt: "2026-08-01T10:30:00.000Z",
          title: "Synthetic Movie",
        },
      ],
      schemaVersion: 3,
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
        code: "INVALID_COLLECTION_INDICATOR",
        row: 2,
        severity: "error",
      },
      { code: "INVALID_RATING", row: 2, severity: "error" },
      { code: "INVALID_IMDB_REFERENCE", row: 2, severity: "warning" },
    ]);
    expect(serializedDiagnostics).not.toContain("PRIVATE");
  });

  it("reports collection indicator disagreement without changing membership", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,Synthetic Saga,,\n`,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows[0].collectionName).toBe("Synthetic Saga");
    expect(result.diagnostics).toEqual([
      {
        code: "COLLECTION_INDICATOR_MISMATCH",
        row: 2,
        severity: "warning",
      },
    ]);
  });

  it("retains uncertain collection indicators as a review warning", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,Maybe,Synthetic Saga,,\n`,
    );

    expect(result.document.validated).toBe(true);
    expect(result.document.rows[0].collectionIndicated).toBeNull();
    expect(result.diagnostics).toEqual([
      {
        code: "COLLECTION_INDICATOR_UNCERTAIN",
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
        nowShowingSourceRow: null,
        ratings: [
          { score: 4, sourceRow: 2 },
          {
            phrase: "Five synthetic marks",
            score: 5,
            sourceRow: 3,
          },
        ],
        schemaVersion: 3,
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
          nowShowingSourceRow: null,
          ratings: [
            { score: 4, sourceRow: 2 },
            { score: 5, sourceRow: 2 },
          ],
          schemaVersion: 3,
        }),
      ),
    ).toBeNull();
    expect(
      parseImportCorrectionsJson(
        JSON.stringify({
          excludedSourceRows: [],
          legacyImdbIds: [],
          nowShowingSourceRow: null,
          ratings: [{ score: 4.25, sourceRow: 2 }],
          schemaVersion: 3,
        }),
      ),
    ).toBeNull();

    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,4 Valid phrase\n`,
      {
        excludedSourceRows: new Set(),
        legacyImdbIds: new Map(),
        nowShowingSourceRow: null,
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
        nowShowingSourceRow: null,
        ratings: [],
        schemaVersion: 3,
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
        nowShowingSourceRow: null,
        ratings: [],
        schemaVersion: 3,
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
          nowShowingSourceRow: null,
          ratings: [],
          schemaVersion: 3,
        }),
      ),
    ).toBeNull();

    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,\n`,
      {
        excludedSourceRows: new Set([3]),
        legacyImdbIds: new Map(),
        nowShowingSourceRow: null,
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

  it("carries one reviewed current selection without retaining source content", () => {
    const corrections = parseImportCorrectionsJson(
      JSON.stringify({
        excludedSourceRows: [],
        legacyImdbIds: [],
        nowShowingSourceRow: 2,
        ratings: [],
        schemaVersion: 3,
      }),
    );
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,\n`,
      corrections!,
    );

    expect(result.document.nowShowingSourceRow).toBe(2);
    expect(result.document.validated).toBe(true);
  });

  it("rejects a current selection that is absent from sanitized rows", () => {
    const result = sanitizeSourceCsv(
      `${header}\n8/1/2026 10:30:00,Synthetic Movie,No,No,,,\n`,
      {
        excludedSourceRows: new Set(),
        legacyImdbIds: new Map(),
        nowShowingSourceRow: 3,
        ratings: new Map(),
      },
    );

    expect(result.document.validated).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "NOW_SHOWING_SOURCE_ROW_UNUSED",
      row: 3,
      severity: "error",
    });
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
      collections: 0,
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
      collections: 0,
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
          collectionIndicated: true,
          collectionName: "Distinct Synthetic Saga",
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

  it("adds only confirmed metadata without replacing the submitted title", async () => {
    const plan = await buildImportPlan(
      document([submission({ legacyImdbId: "tt1234567" })]),
      "2026-08-10T11:00:00.000Z",
      reconciliation(),
    );
    const sql = plan.statements.join("\n");

    expect(plan.diagnostics).toEqual([]);
    expect(sql).toContain("'Synthetic Movie'");
    expect(sql).toContain("'/synthetic.jpg'");
    expect(sql).toContain("tmdb_id = 42");
    expect(sql).toContain("tmdb_collection_id = 7");
    expect(sql).toContain("tmdb_collection_name = 'Synthetic Collection'");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM movies AS linked");
  });

  it("rejects a reconciliation match that the import does not use", async () => {
    const plan = await buildImportPlan(
      document([submission({ legacyImdbId: "tt7654321" })]),
      "2026-08-10T11:00:00.000Z",
      reconciliation(),
    );

    expect(plan.statements).toEqual([]);
    expect(plan.diagnostics).toEqual([
      { code: "TMDB_MATCH_UNUSED", row: null, severity: "error" },
    ]);
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
        collectionIndicated: true,
        collectionName: "Synthetic Saga",
        rating: { phrase: "Director's choice", score: 5 },
      }),
    ]);
    const importedAt = "2026-08-06T20:00:00.000Z";

    const first = await buildImportPlan(input, importedAt);
    const second = await buildImportPlan(input, importedAt);
    expect(second).toEqual(first);
    expect(first.statements.join("\n")).toContain("Director''s choice");
  });

  it("restores an unwatched collection selection pending user order", async () => {
    const plan = await buildImportPlan(
      document(
        [
          submission({
            collectionIndicated: true,
            collectionName: "Synthetic Saga",
          }),
        ],
        2,
      ),
      "2026-08-06T20:00:00.000Z",
    );
    const sql = plan.statements.join("\n");

    expect(plan.diagnostics).toEqual([]);
    expect(sql).toContain("status = 'pending_order'");
    expect(sql).toContain("rolled_movie_id = NULL");
    expect(sql).not.toContain("INSERT INTO rolls");
    expect(sql).not.toContain("INSERT INTO audit_log");
  });

  it("restores an unwatched standalone selection ready to rate", async () => {
    const plan = await buildImportPlan(
      document([submission()], 2),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.statements.join("\n")).toContain(
      "collection_id = NULL, status = 'ready'",
    );
  });

  it("rejects a watched movie as the current selection", async () => {
    const plan = await buildImportPlan(
      document(
        [
          submission({
            rating: { phrase: "Already watched", score: 4 },
          }),
        ],
        2,
      ),
      "2026-08-06T20:00:00.000Z",
    );

    expect(plan.statements).toEqual([]);
    expect(plan.diagnostics).toContainEqual({
      code: "NOW_SHOWING_ALREADY_WATCHED",
      row: 2,
      severity: "error",
    });
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

  it("accepts only complete exact-title reconciliation documents", () => {
    const valid = reconciliation();
    expect(parseTmdbReconciliationJson(JSON.stringify(valid))).toEqual(valid);
    expect(
      parseTmdbReconciliationJson(
        JSON.stringify({ ...valid, complete: false }),
      ),
    ).toBeNull();
    expect(
      parseTmdbReconciliationJson(
        JSON.stringify({
          ...valid,
          matches: [{ ...valid.matches[0], runtimeMinutes: 0 }],
        }),
      ),
    ).toBeNull();
    expect(
      parseTmdbReconciliationJson(
        JSON.stringify({
          ...valid,
          matches: [
            {
              ...valid.matches[0],
              providerTitleNormalized: "different movie",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseTmdbReconciliationJson(
        JSON.stringify({
          ...valid,
          matches: [
            {
              ...valid.matches[0],
              tmdbCollectionName: null,
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("update-only TMDB metadata planning", () => {
  it("targets a confirmed existing identity without structural writes", () => {
    const plan = buildTmdbMetadataPlan(
      document([
        submission({
          collectionIndicated: true,
          collectionName: "Corrected Synthetic Saga",
          legacyImdbId: "tt1234567",
        }),
      ]),
      reconciliation(),
      "2026-08-10T11:00:00.000Z",
    );
    const sql = plan.statements.join("\n");

    expect(plan.counts).toEqual({
      collections: 0,
      movies: 1,
      ratings: 0,
      sources: 0,
    });
    expect(plan.diagnostics).toEqual([]);
    expect(sql).toContain("UPDATE movies SET release_date");
    expect(sql).toContain("runtime_minutes = 123");
    expect(sql).toContain("tmdb_collection_id = 7");
    expect(sql).toContain("tmdb_collection_name = 'Synthetic Collection'");
    expect(sql).toContain(
      "WHERE legacy_imdb_id = 'tt1234567' AND title_normalized = 'synthetic movie'",
    );
    expect(sql).not.toMatch(
      /INSERT|DELETE|collection_movies|now_showing|ratings/,
    );
  });

  it("rejects a match when one legacy ID represents conflicting source identities", () => {
    const plan = buildTmdbMetadataPlan(
      document([
        submission({ legacyImdbId: "tt1234567" }),
        submission({
          legacyImdbId: "tt1234567",
          sourceRow: 3,
          title: "Different Synthetic Movie",
        }),
      ]),
      reconciliation(),
      "2026-08-10T11:00:00.000Z",
    );

    expect(plan.statements).toEqual([]);
    expect(plan.diagnostics).toEqual([
      { code: "TMDB_MATCH_UNUSED", row: null, severity: "error" },
    ]);
  });
});
