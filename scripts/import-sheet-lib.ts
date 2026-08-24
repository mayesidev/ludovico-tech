import { parse } from "csv-parse/sync";
import { parseImdbId as parseImdbIdValue } from "../src/shared/imdb";
import type { TmdbPerson } from "../src/shared/tmdb-credits";

export const INTERMEDIATE_SCHEMA_VERSION = 3 as const;
export const TMDB_RECONCILIATION_SCHEMA_VERSION = 4 as const;

const SOURCE_COLUMN_INDEX = {
  submittedAt: 0,
  title: 1,
  priorViewed: 2,
  collectionIndicated: 3,
  collectionName: 4,
  legacyImdbReference: 5,
  rating: 6,
} as const;
const SOURCE_COLUMN_COUNT = Object.keys(SOURCE_COLUMN_INDEX).length;

export type DiagnosticSeverity = "error" | "warning";

export type ImportDiagnosticCode =
  | "COLLECTION_CORRECTION_UNUSED"
  | "COLLECTION_ORDER_INVALID"
  | "CONFLICTING_RATING"
  | "DUPLICATE_EXTERNAL_ID"
  | "DUPLICATE_SOURCE_ROW"
  | "EXTERNAL_ID_CORRECTION_UNUSED"
  | "COLLECTION_INDICATOR_MISMATCH"
  | "COLLECTION_INDICATOR_UNCERTAIN"
  | "INTERMEDIATE_SCHEMA_INVALID"
  | "INVALID_COLLECTION_INDICATOR"
  | "INVALID_IMDB_REFERENCE"
  | "INVALID_PRIOR_VIEWED"
  | "INVALID_RATING"
  | "INVALID_SUBMISSION_TIMESTAMP"
  | "MISSING_TITLE"
  | "NOW_SHOWING_ALREADY_WATCHED"
  | "NOW_SHOWING_SOURCE_ROW_UNUSED"
  | "RATING_CORRECTION_UNUSED"
  | "SOURCE_ROW_EXCLUDED"
  | "SOURCE_ROW_EXCLUSION_UNUSED"
  | "SOURCE_COLUMN_COUNT"
  | "SOURCE_CSV_INVALID"
  | "SOURCE_EMPTY"
  | "TMDB_MATCH_UNUSED"
  | "TMDB_RECONCILIATION_INVALID"
  | "TITLE_CORRECTION_UNUSED";

export interface ImportDiagnostic {
  code: ImportDiagnosticCode;
  row: number | null;
  severity: DiagnosticSeverity;
}

export interface GeneralizedRating {
  phrase: string;
  score: number;
}

export interface RatingCorrection {
  phrase?: string;
  score: number;
}

export interface ImportCorrections {
  collectionNames: ReadonlyMap<number, string>;
  collectionOrders: GeneralizedCollectionOrder[];
  excludedSourceRows: ReadonlySet<number>;
  legacyImdbIds: ReadonlyMap<number, string>;
  nowShowingSourceRow: number | null;
  ratings: ReadonlyMap<number, RatingCorrection>;
  titles: ReadonlyMap<number, string>;
}

const emptyImportCorrections = (): ImportCorrections => ({
  collectionNames: new Map(),
  collectionOrders: [],
  excludedSourceRows: new Set(),
  legacyImdbIds: new Map(),
  nowShowingSourceRow: null,
  ratings: new Map(),
  titles: new Map(),
});

export interface GeneralizedCollectionOrder {
  name: string;
  sourceRows: number[];
}

export interface GeneralizedSubmission {
  collectionIndicated: boolean | null;
  collectionName: string | null;
  legacyImdbId: string | null;
  priorViewed: boolean;
  rating: GeneralizedRating | null;
  sourceRow: number;
  submittedAt: string;
  title: string;
}

export interface GeneralizedImportDocument {
  collectionOrders: GeneralizedCollectionOrder[];
  nowShowingSourceRow: number | null;
  rows: GeneralizedSubmission[];
  schemaVersion: typeof INTERMEDIATE_SCHEMA_VERSION;
  validated: boolean;
}

export interface ConfirmedTmdbMatch {
  cast: TmdbPerson[];
  directors: TmdbPerson[];
  legacyImdbId: string;
  posterPath: string | null;
  providerTitleNormalized: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  sourceTitleNormalized: string;
  tmdbCollectionId: number | null;
  tmdbCollectionName: string | null;
  tmdbId: number;
}

export interface TmdbReconciliationDocument {
  complete: true;
  generatedAt: string;
  matches: ConfirmedTmdbMatch[];
  schemaVersion: typeof TMDB_RECONCILIATION_SCHEMA_VERSION;
}

export interface SanitizationResult {
  diagnostics: ImportDiagnostic[];
  document: GeneralizedImportDocument;
}

export interface ImportCounts {
  collections: number;
  movies: number;
  ratings: number;
  sources: number;
}

export interface ImportPlan {
  counts: ImportCounts;
  diagnostics: ImportDiagnostic[];
  nowShowingStatus: "empty" | "ready" | null;
  statements: string[];
}

export const buildTmdbMetadataPlan = (
  document: GeneralizedImportDocument,
  reconciliation: TmdbReconciliationDocument,
  appliedAt: string,
): ImportPlan => {
  if (
    document.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
    !document.validated ||
    !document.rows.every(isSubmission) ||
    reconciliation.schemaVersion !== TMDB_RECONCILIATION_SCHEMA_VERSION ||
    !reconciliation.complete ||
    parseSubmissionTimestamp(appliedAt) !== appliedAt
  ) {
    return {
      counts: { collections: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics: [diagnostic("INTERMEDIATE_SCHEMA_INVALID", null)],
      nowShowingStatus: null,
      statements: [],
    };
  }

  const rowsByLegacyId = new Map<string, GeneralizedSubmission[]>();
  for (const row of document.rows) {
    if (!row.legacyImdbId) continue;
    const rows = rowsByLegacyId.get(row.legacyImdbId) ?? [];
    rows.push(row);
    rowsByLegacyId.set(row.legacyImdbId, rows);
  }

  const diagnostics: ImportDiagnostic[] = [];
  const statements: string[] = [];
  let matchedMovies = 0;
  for (const match of reconciliation.matches) {
    const sourceRows = rowsByLegacyId.get(match.legacyImdbId) ?? [];
    const identities = new Set(
      sourceRows.map(
        (row) =>
          `${normalize(row.title)}\u0000${normalize(row.collectionName ?? "")}`,
      ),
    );
    if (
      identities.size !== 1 ||
      !sourceRows.every(
        (row) => normalize(row.title) === match.sourceTitleNormalized,
      )
    ) {
      diagnostics.push(diagnostic("TMDB_MATCH_UNUSED", null));
      continue;
    }

    statements.push(
      `UPDATE movies SET release_date = ${sql(match.releaseDate)}, poster_path = ${sql(match.posterPath)}, runtime_minutes = ${sql(match.runtimeMinutes)}, tmdb_id = ${match.tmdbId}, tmdb_collection_id = ${sql(match.tmdbCollectionId)}, tmdb_collection_name = ${sql(match.tmdbCollectionName)}, tmdb_fetched_at = ${sql(reconciliation.generatedAt)} WHERE imdb_id = ${sql(match.legacyImdbId)} AND title_normalized = ${sql(match.sourceTitleNormalized)} AND (tmdb_id IS NULL OR tmdb_id = ${match.tmdbId}) AND NOT EXISTS (SELECT 1 FROM movies AS linked WHERE linked.tmdb_id = ${match.tmdbId} AND linked.imdb_id <> ${sql(match.legacyImdbId)});`,
    );
    matchedMovies += 1;
    const movieId = `(SELECT id FROM movies WHERE imdb_id = ${sql(match.legacyImdbId)} AND title_normalized = ${sql(match.sourceTitleNormalized)} AND tmdb_id = ${match.tmdbId} LIMIT 1)`;
    statements.push(
      ...tmdbDataStatements(
        movieId,
        match,
        reconciliation.generatedAt,
        `${movieId} IS NOT NULL`,
      ),
    );
    statements.push(
      ...tmdbCreditStatements(
        movieId,
        match,
        reconciliation.generatedAt,
        `${movieId} IS NOT NULL`,
      ),
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return {
      counts: { collections: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics,
      nowShowingStatus: null,
      statements: [],
    };
  }
  return {
    counts: {
      collections: 0,
      movies: matchedMovies,
      ratings: 0,
      sources: 0,
    },
    diagnostics,
    nowShowingStatus: null,
    statements,
  };
};

export interface SqlChunk {
  filename: string;
  sql: string;
}

const diagnostic = (
  code: ImportDiagnosticCode,
  row: number | null,
  severity: DiagnosticSeverity = "error",
): ImportDiagnostic => ({ code, row, severity });

export const normalizeCatalogText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalize = normalizeCatalogText;

const parseBoolean = (value: string) => {
  switch (normalize(value)) {
    case "1":
    case "true":
    case "y":
    case "yes":
      return true;
    case "0":
    case "false":
    case "n":
    case "no":
      return false;
    default:
      return null;
  }
};

const parseCollectionIndicator = (value: string) => {
  const parsed = parseBoolean(value);
  if (parsed !== null) return parsed;
  return normalize(value) === "maybe" ? null : undefined;
};

const validUtcDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) => {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date.toISOString();
};

const parseSubmissionTimestamp = (value: string) => {
  const trimmed = value.trim();
  const zoned = trimmed.match(/(?:Z|[+-]\d\d:\d\d)$/i);
  if (zoned) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i,
  );
  if (!match) return null;

  let hour = Number(match[4]);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  }

  return validUtcDate(
    Number(match[3]),
    Number(match[1]),
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6] ?? 0),
  );
};

const parseRating = (value: string): GeneralizedRating | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const leading = trimmed.match(
    /^(0(?:\.0|\.5)?|[1-4](?:\.0|\.5)?|5(?:\.0)?)\s*(?:[-–—:]\s*)?(.+)$/,
  );
  const trailing = trimmed.match(
    /^(.+?)\s*(?:[-–—:]\s*)?(0(?:\.0)?|[1-4](?:\.0|\.5)?|5(?:\.0)?)$/,
  );
  if (!leading && !trailing) return undefined;
  const score = Number(leading?.[1] ?? trailing?.[2]);
  const phrase = (leading?.[2] ?? trailing?.[1] ?? "").trim();
  if (!phrase || phrase.length > 120 || score * 2 !== Math.trunc(score * 2)) {
    return undefined;
  }
  return { phrase, score };
};

const validRatingScore = (value: number) =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 5 &&
  value * 2 === Math.trunc(value * 2);

const validRatingPhrase = (value: string) =>
  value === value.trim() && value.length > 0 && value.length <= 120;

const parseImdbId = (value: string) => {
  const parsed = parseImdbIdValue(value);
  return {
    id: parsed === undefined ? null : parsed,
    valid: parsed !== undefined,
  };
};

export const sanitizeSourceCsv = (
  source: string,
  corrections: ImportCorrections = emptyImportCorrections(),
): SanitizationResult => {
  let records: string[][];
  try {
    records = parse(source, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];
  } catch {
    return {
      diagnostics: [diagnostic("SOURCE_CSV_INVALID", null)],
      document: {
        collectionOrders: corrections.collectionOrders,
        nowShowingSourceRow: corrections.nowShowingSourceRow,
        rows: [],
        schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
        validated: false,
      },
    };
  }

  if (records.length === 0) {
    return {
      diagnostics: [diagnostic("SOURCE_EMPTY", null)],
      document: {
        collectionOrders: corrections.collectionOrders,
        nowShowingSourceRow: corrections.nowShowingSourceRow,
        rows: [],
        schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
        validated: false,
      },
    };
  }

  const diagnostics: ImportDiagnostic[] = [];
  const rows: GeneralizedSubmission[] = [];
  const appliedSourceRowExclusions = new Set<number>();
  const appliedCollectionCorrections = new Set<number>();
  const appliedExternalIdCorrections = new Set<number>();
  const appliedRatingCorrections = new Set<number>();
  const appliedTitleCorrections = new Set<number>();

  for (const [index, record] of records.slice(1).entries()) {
    const sourceRow = index + 2;
    if (corrections.excludedSourceRows.has(sourceRow)) {
      appliedSourceRowExclusions.add(sourceRow);
      diagnostics.push(diagnostic("SOURCE_ROW_EXCLUDED", sourceRow, "warning"));
      continue;
    }
    if (record.length !== SOURCE_COLUMN_COUNT) {
      diagnostics.push(diagnostic("SOURCE_COLUMN_COUNT", sourceRow));
      continue;
    }

    const submittedAt = parseSubmissionTimestamp(
      record[SOURCE_COLUMN_INDEX.submittedAt] ?? "",
    );
    const sourceTitle = (record[SOURCE_COLUMN_INDEX.title] ?? "").trim();
    const titleCorrection = corrections.titles.get(sourceRow);
    const title = titleCorrection ?? sourceTitle;
    if (titleCorrection && titleCorrection !== sourceTitle) {
      appliedTitleCorrections.add(sourceRow);
    }
    const priorViewed = parseBoolean(
      record[SOURCE_COLUMN_INDEX.priorViewed] ?? "",
    );
    const collectionIndicated = parseCollectionIndicator(
      record[SOURCE_COLUMN_INDEX.collectionIndicated] ?? "",
    );
    const sourceCollectionName =
      (record[SOURCE_COLUMN_INDEX.collectionName] ?? "").trim() || null;
    const collectionCorrection = corrections.collectionNames.get(sourceRow);
    const collectionName = collectionCorrection ?? sourceCollectionName;
    if (collectionCorrection && collectionCorrection !== sourceCollectionName) {
      appliedCollectionCorrections.add(sourceRow);
    }
    let imdb = parseImdbId(
      record[SOURCE_COLUMN_INDEX.legacyImdbReference] ?? "",
    );
    const externalIdCorrection = corrections.legacyImdbIds.get(sourceRow);
    if (externalIdCorrection) {
      imdb = { id: externalIdCorrection, valid: true };
      appliedExternalIdCorrections.add(sourceRow);
    }
    const sourceRating = record[SOURCE_COLUMN_INDEX.rating] ?? "";
    let rating = parseRating(sourceRating);
    const correction = corrections.ratings.get(sourceRow);
    if (correction) {
      if (rating !== undefined || !sourceRating.trim()) {
        diagnostics.push(diagnostic("RATING_CORRECTION_UNUSED", sourceRow));
      } else {
        const phrase = correction.phrase ?? sourceRating.trim();
        rating =
          validRatingScore(correction.score) && validRatingPhrase(phrase)
            ? { phrase, score: correction.score }
            : undefined;
        appliedRatingCorrections.add(sourceRow);
      }
    }

    if (!submittedAt) {
      diagnostics.push(diagnostic("INVALID_SUBMISSION_TIMESTAMP", sourceRow));
    }
    if (!title) diagnostics.push(diagnostic("MISSING_TITLE", sourceRow));
    if (priorViewed === null) {
      diagnostics.push(diagnostic("INVALID_PRIOR_VIEWED", sourceRow));
    }
    if (collectionIndicated === undefined) {
      diagnostics.push(diagnostic("INVALID_COLLECTION_INDICATOR", sourceRow));
    }
    if (rating === undefined) {
      diagnostics.push(diagnostic("INVALID_RATING", sourceRow));
    }
    if (!imdb.valid) {
      diagnostics.push(
        diagnostic("INVALID_IMDB_REFERENCE", sourceRow, "warning"),
      );
    }
    if (
      collectionIndicated !== undefined &&
      collectionIndicated !== null &&
      collectionIndicated !== Boolean(collectionName)
    ) {
      diagnostics.push(
        diagnostic("COLLECTION_INDICATOR_MISMATCH", sourceRow, "warning"),
      );
    }
    if (collectionIndicated === null) {
      diagnostics.push(
        diagnostic("COLLECTION_INDICATOR_UNCERTAIN", sourceRow, "warning"),
      );
    }

    if (
      submittedAt &&
      title &&
      priorViewed !== null &&
      collectionIndicated !== undefined &&
      rating !== undefined
    ) {
      rows.push({
        collectionIndicated,
        collectionName,
        legacyImdbId: imdb.id,
        priorViewed,
        rating,
        sourceRow,
        submittedAt,
        title,
      });
    }
  }

  for (const sourceRow of corrections.excludedSourceRows) {
    if (!appliedSourceRowExclusions.has(sourceRow)) {
      diagnostics.push(diagnostic("SOURCE_ROW_EXCLUSION_UNUSED", sourceRow));
    }
  }

  for (const sourceRow of corrections.legacyImdbIds.keys()) {
    if (!appliedExternalIdCorrections.has(sourceRow)) {
      diagnostics.push(diagnostic("EXTERNAL_ID_CORRECTION_UNUSED", sourceRow));
    }
  }

  for (const sourceRow of corrections.ratings.keys()) {
    if (!appliedRatingCorrections.has(sourceRow)) {
      if (
        !diagnostics.some(
          (item) =>
            item.code === "RATING_CORRECTION_UNUSED" && item.row === sourceRow,
        )
      ) {
        diagnostics.push(diagnostic("RATING_CORRECTION_UNUSED", sourceRow));
      }
    }
  }

  for (const sourceRow of corrections.titles.keys()) {
    if (!appliedTitleCorrections.has(sourceRow)) {
      diagnostics.push(diagnostic("TITLE_CORRECTION_UNUSED", sourceRow));
    }
  }

  for (const sourceRow of corrections.collectionNames.keys()) {
    if (!appliedCollectionCorrections.has(sourceRow)) {
      diagnostics.push(diagnostic("COLLECTION_CORRECTION_UNUSED", sourceRow));
    }
  }

  for (const order of corrections.collectionOrders) {
    const actualRows = rows
      .filter(
        (row) => normalize(row.collectionName ?? "") === normalize(order.name),
      )
      .map((row) => row.sourceRow)
      .sort((left, right) => left - right);
    const expectedRows = [...order.sourceRows].sort(
      (left, right) => left - right,
    );
    if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
      diagnostics.push(diagnostic("COLLECTION_ORDER_INVALID", null));
    }
  }

  if (
    corrections.nowShowingSourceRow !== null &&
    !rows.some((row) => row.sourceRow === corrections.nowShowingSourceRow)
  ) {
    diagnostics.push(
      diagnostic(
        "NOW_SHOWING_SOURCE_ROW_UNUSED",
        corrections.nowShowingSourceRow,
      ),
    );
  }

  return {
    diagnostics,
    document: {
      collectionOrders: corrections.collectionOrders,
      nowShowingSourceRow: corrections.nowShowingSourceRow,
      rows,
      schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
      validated: !diagnostics.some((item) => item.severity === "error"),
    },
  };
};

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

const isCollectionIndicator = (value: unknown): value is boolean | null =>
  value === null || isBoolean(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const hasExactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected.sort().every((key, index) => actual[index] === key)
  );
};

export const parseImportCorrectionsJson = (
  source: string,
): ImportCorrections | null => {
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasExactKeys(value, [
        "collectionNames",
        "collectionOrders",
        "excludedSourceRows",
        "legacyImdbIds",
        "nowShowingSourceRow",
        "ratings",
        "schemaVersion",
        "titles",
      ]) ||
      !Array.isArray(value.collectionNames) ||
      !Array.isArray(value.collectionOrders) ||
      value.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
      !Array.isArray(value.excludedSourceRows) ||
      !Array.isArray(value.legacyImdbIds) ||
      !Array.isArray(value.ratings) ||
      !Array.isArray(value.titles) ||
      !(
        value.nowShowingSourceRow === null ||
        (Number.isInteger(value.nowShowingSourceRow) &&
          Number(value.nowShowingSourceRow) >= 2)
      )
    ) {
      return null;
    }

    const excludedSourceRows = new Set<number>();
    for (const sourceRow of value.excludedSourceRows) {
      if (
        !Number.isInteger(sourceRow) ||
        Number(sourceRow) < 2 ||
        excludedSourceRows.has(Number(sourceRow))
      ) {
        return null;
      }
      excludedSourceRows.add(Number(sourceRow));
    }

    const parseTextCorrections = (items: unknown[], key: "name" | "title") => {
      const parsed = new Map<number, string>();
      for (const item of items) {
        if (!item || typeof item !== "object") return null;
        const correction = item as Record<string, unknown>;
        if (
          !hasExactKeys(correction, [key, "sourceRow"]) ||
          !Number.isInteger(correction.sourceRow) ||
          Number(correction.sourceRow) < 2 ||
          typeof correction[key] !== "string" ||
          correction[key] !== String(correction[key]).trim() ||
          String(correction[key]).length === 0 ||
          String(correction[key]).length > 200 ||
          parsed.has(Number(correction.sourceRow))
        ) {
          return null;
        }
        parsed.set(Number(correction.sourceRow), String(correction[key]));
      }
      return parsed;
    };
    const collectionNames = parseTextCorrections(value.collectionNames, "name");
    const titles = parseTextCorrections(value.titles, "title");
    if (!collectionNames || !titles) return null;

    const collectionOrders: GeneralizedCollectionOrder[] = [];
    const orderedCollectionNames = new Set<string>();
    for (const item of value.collectionOrders) {
      if (!item || typeof item !== "object") return null;
      const order = item as Record<string, unknown>;
      if (
        !hasExactKeys(order, ["name", "sourceRows"]) ||
        typeof order.name !== "string" ||
        order.name !== order.name.trim() ||
        !order.name ||
        order.name.length > 200 ||
        !Array.isArray(order.sourceRows) ||
        order.sourceRows.length < 2 ||
        order.sourceRows.some(
          (sourceRow) => !Number.isInteger(sourceRow) || Number(sourceRow) < 2,
        ) ||
        new Set(order.sourceRows).size !== order.sourceRows.length ||
        orderedCollectionNames.has(normalize(order.name))
      ) {
        return null;
      }
      orderedCollectionNames.add(normalize(order.name));
      collectionOrders.push({
        name: order.name,
        sourceRows: order.sourceRows.map(Number),
      });
    }

    const legacyImdbIds = new Map<number, string>();
    for (const item of value.legacyImdbIds) {
      if (!item || typeof item !== "object") return null;
      const correction = item as Record<string, unknown>;
      if (
        !hasExactKeys(correction, ["id", "sourceRow"]) ||
        !Number.isInteger(correction.sourceRow) ||
        Number(correction.sourceRow) < 2 ||
        typeof correction.id !== "string" ||
        !/^tt\d{6,9}$/.test(correction.id) ||
        legacyImdbIds.has(Number(correction.sourceRow))
      ) {
        return null;
      }
      legacyImdbIds.set(Number(correction.sourceRow), correction.id);
    }

    const corrections = new Map<number, RatingCorrection>();
    for (const item of value.ratings) {
      if (!item || typeof item !== "object") return null;
      const correction = item as Record<string, unknown>;
      const expectedKeys =
        correction.phrase === undefined
          ? ["score", "sourceRow"]
          : ["phrase", "score", "sourceRow"];
      if (
        !hasExactKeys(correction, expectedKeys) ||
        !Number.isInteger(correction.sourceRow) ||
        Number(correction.sourceRow) < 2 ||
        typeof correction.score !== "number" ||
        !validRatingScore(correction.score) ||
        (correction.phrase !== undefined &&
          (typeof correction.phrase !== "string" ||
            !validRatingPhrase(correction.phrase))) ||
        corrections.has(Number(correction.sourceRow))
      ) {
        return null;
      }
      corrections.set(Number(correction.sourceRow), {
        ...(typeof correction.phrase === "string"
          ? { phrase: correction.phrase }
          : {}),
        score: correction.score,
      });
    }
    return {
      collectionNames,
      collectionOrders,
      excludedSourceRows,
      legacyImdbIds,
      nowShowingSourceRow:
        value.nowShowingSourceRow === null
          ? null
          : Number(value.nowShowingSourceRow),
      ratings: corrections,
      titles,
    };
  } catch {
    return null;
  }
};

const isRating = (value: unknown): value is GeneralizedRating | null => {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const rating = value as Record<string, unknown>;
  return (
    hasExactKeys(rating, ["phrase", "score"]) &&
    typeof rating.score === "number" &&
    validRatingScore(rating.score) &&
    typeof rating.phrase === "string" &&
    validRatingPhrase(rating.phrase)
  );
};

const isSubmission = (value: unknown): value is GeneralizedSubmission => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    hasExactKeys(row, [
      "collectionIndicated",
      "collectionName",
      "legacyImdbId",
      "priorViewed",
      "rating",
      "sourceRow",
      "submittedAt",
      "title",
    ]) &&
    Number.isInteger(row.sourceRow) &&
    Number(row.sourceRow) >= 2 &&
    typeof row.submittedAt === "string" &&
    parseSubmissionTimestamp(row.submittedAt) === row.submittedAt &&
    typeof row.title === "string" &&
    row.title === row.title.trim() &&
    row.title.length > 0 &&
    isBoolean(row.priorViewed) &&
    isCollectionIndicator(row.collectionIndicated) &&
    isNullableString(row.collectionName) &&
    (row.collectionName === null ||
      (row.collectionName === row.collectionName.trim() &&
        row.collectionName.length > 0)) &&
    isNullableString(row.legacyImdbId) &&
    (row.legacyImdbId === null || /^tt\d{6,9}$/.test(row.legacyImdbId)) &&
    isRating(row.rating)
  );
};

export const parseIntermediateJson = (
  source: string,
): GeneralizedImportDocument | null => {
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasExactKeys(value, [
        "collectionOrders",
        "nowShowingSourceRow",
        "rows",
        "schemaVersion",
        "validated",
      ]) ||
      value.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
      value.validated !== true ||
      !Array.isArray(value.rows) ||
      !Array.isArray(value.collectionOrders) ||
      !value.collectionOrders.every((item) => {
        if (!item || typeof item !== "object") return false;
        const order = item as Record<string, unknown>;
        return (
          hasExactKeys(order, ["name", "sourceRows"]) &&
          typeof order.name === "string" &&
          order.name === order.name.trim() &&
          order.name.length > 0 &&
          order.name.length <= 200 &&
          Array.isArray(order.sourceRows) &&
          order.sourceRows.length >= 2 &&
          order.sourceRows.every(
            (row) => Number.isInteger(row) && Number(row) >= 2,
          ) &&
          new Set(order.sourceRows).size === order.sourceRows.length
        );
      }) ||
      !value.rows.every(isSubmission) ||
      !(
        value.nowShowingSourceRow === null ||
        (Number.isInteger(value.nowShowingSourceRow) &&
          Number(value.nowShowingSourceRow) >= 2 &&
          value.rows.some(
            (row) =>
              isSubmission(row) && row.sourceRow === value.nowShowingSourceRow,
          ))
      )
    ) {
      return null;
    }
    const document = value as unknown as GeneralizedImportDocument;
    const orderedNames = new Set<string>();
    for (const order of document.collectionOrders) {
      const normalizedName = normalize(order.name);
      const actualRows = document.rows
        .filter((row) => normalize(row.collectionName ?? "") === normalizedName)
        .map((row) => row.sourceRow)
        .sort((left, right) => left - right);
      const expectedRows = [...order.sourceRows].sort(
        (left, right) => left - right,
      );
      if (
        orderedNames.has(normalizedName) ||
        JSON.stringify(actualRows) !== JSON.stringify(expectedRows)
      ) {
        return null;
      }
      orderedNames.add(normalizedName);
    }
    return document;
  } catch {
    return null;
  }
};

export const parseTmdbReconciliationJson = (
  source: string,
): TmdbReconciliationDocument | null => {
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasExactKeys(value, [
        "complete",
        "generatedAt",
        "matches",
        "schemaVersion",
      ]) ||
      value.complete !== true ||
      value.schemaVersion !== TMDB_RECONCILIATION_SCHEMA_VERSION ||
      typeof value.generatedAt !== "string" ||
      parseSubmissionTimestamp(value.generatedAt) !== value.generatedAt ||
      !Array.isArray(value.matches)
    ) {
      return null;
    }

    const legacyIds = new Set<string>();
    const tmdbIds = new Set<number>();
    const validPeople = (people: unknown, limit: number) => {
      if (!Array.isArray(people) || people.length > limit) return false;
      const ids = new Set<number>();
      for (const item of people) {
        if (!item || typeof item !== "object") return false;
        const person = item as Record<string, unknown>;
        if (
          !hasExactKeys(person, ["id", "name"]) ||
          !Number.isInteger(person.id) ||
          Number(person.id) <= 0 ||
          typeof person.name !== "string" ||
          person.name.trim() !== person.name ||
          person.name.length < 1 ||
          person.name.length > 200 ||
          ids.has(Number(person.id))
        ) {
          return false;
        }
        ids.add(Number(person.id));
      }
      return true;
    };
    for (const item of value.matches) {
      if (!item || typeof item !== "object") return null;
      const match = item as Record<string, unknown>;
      if (
        !hasExactKeys(match, [
          "cast",
          "directors",
          "legacyImdbId",
          "posterPath",
          "providerTitleNormalized",
          "releaseDate",
          "runtimeMinutes",
          "sourceTitleNormalized",
          "tmdbCollectionId",
          "tmdbCollectionName",
          "tmdbId",
        ]) ||
        !validPeople(match.cast, 5) ||
        !validPeople(match.directors, 3) ||
        typeof match.legacyImdbId !== "string" ||
        !/^tt\d{6,9}$/.test(match.legacyImdbId) ||
        !Number.isInteger(match.tmdbId) ||
        Number(match.tmdbId) <= 0 ||
        typeof match.sourceTitleNormalized !== "string" ||
        !match.sourceTitleNormalized ||
        normalize(match.sourceTitleNormalized) !==
          match.sourceTitleNormalized ||
        match.providerTitleNormalized !== match.sourceTitleNormalized ||
        (match.releaseDate !== null &&
          (typeof match.releaseDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(match.releaseDate))) ||
        (match.runtimeMinutes !== null &&
          (!Number.isSafeInteger(match.runtimeMinutes) ||
            Number(match.runtimeMinutes) <= 0)) ||
        !(
          (match.tmdbCollectionId === null &&
            match.tmdbCollectionName === null) ||
          (Number.isInteger(match.tmdbCollectionId) &&
            Number(match.tmdbCollectionId) > 0 &&
            typeof match.tmdbCollectionName === "string" &&
            match.tmdbCollectionName.trim() === match.tmdbCollectionName &&
            match.tmdbCollectionName.length >= 1 &&
            match.tmdbCollectionName.length <= 200)
        ) ||
        (match.posterPath !== null &&
          (typeof match.posterPath !== "string" ||
            !/^\/[A-Za-z0-9._-]{1,200}$/.test(match.posterPath))) ||
        legacyIds.has(match.legacyImdbId) ||
        tmdbIds.has(Number(match.tmdbId))
      ) {
        return null;
      }
      legacyIds.add(match.legacyImdbId);
      tmdbIds.add(Number(match.tmdbId));
    }
    return value as unknown as TmdbReconciliationDocument;
  } catch {
    return null;
  }
};

const hash = async (scope: string, value: string) => {
  const bytes = new TextEncoder().encode(`${scope}\u0000${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const stableId = async (scope: string, value: string) =>
  `${scope}_${(await hash(scope, value)).slice(0, 32)}`;

const sql = (value: string | number | null) => {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite SQL number");
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
};

const tmdbCreditStatements = (
  movieId: string,
  match: ConfirmedTmdbMatch,
  updatedAt: string,
  condition: string,
) => {
  const statements = [
    `DELETE FROM movie_credits WHERE movie_id = ${movieId} AND ${condition};`,
  ];
  const people = new Map(
    [...match.cast, ...match.directors].map((person) => [person.id, person]),
  );
  for (const person of people.values()) {
    statements.push(
      `INSERT INTO tmdb_people (tmdb_id, name, updated_at, fetched_at) VALUES (${person.id}, ${sql(person.name)}, ${sql(updatedAt)}, ${sql(updatedAt)}) ON CONFLICT(tmdb_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, fetched_at = excluded.fetched_at WHERE excluded.fetched_at >= COALESCE(tmdb_people.fetched_at, tmdb_people.updated_at);`,
    );
  }
  for (const [index, person] of match.cast.entries()) {
    statements.push(
      `INSERT OR REPLACE INTO movie_credits (movie_id, tmdb_person_id, credit_type, position) SELECT ${movieId}, ${person.id}, 'cast', ${index + 1} WHERE ${condition};`,
    );
  }
  for (const [index, person] of match.directors.entries()) {
    statements.push(
      `INSERT OR REPLACE INTO movie_credits (movie_id, tmdb_person_id, credit_type, position) SELECT ${movieId}, ${person.id}, 'director', ${index + 1} WHERE ${condition};`,
    );
  }
  statements.push(
    "DELETE FROM tmdb_people WHERE NOT EXISTS (SELECT 1 FROM movie_credits WHERE movie_credits.tmdb_person_id = tmdb_people.tmdb_id);",
  );
  return statements;
};

const tmdbDataStatements = (
  movieId: string,
  match: ConfirmedTmdbMatch,
  fetchedAt: string,
  condition: string,
) => {
  const expiresAt = new Date(
    new Date(fetchedAt).getTime() + 175 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const statements: string[] = [];
  if (match.tmdbCollectionId !== null && match.tmdbCollectionName !== null) {
    statements.push(
      `INSERT INTO tmdb_collections (tmdb_id, name, fetched_at) VALUES (${match.tmdbCollectionId}, ${sql(match.tmdbCollectionName)}, ${sql(fetchedAt)}) ON CONFLICT(tmdb_id) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at WHERE excluded.fetched_at >= tmdb_collections.fetched_at;`,
    );
  }
  statements.push(
    `INSERT INTO movie_tmdb_data (movie_id, tmdb_id, title, release_date, poster_path, runtime_minutes, tmdb_collection_id, fetched_at, refresh_after, expires_at, data_version) SELECT ${movieId}, ${match.tmdbId}, movies.title, ${sql(match.releaseDate)}, ${sql(match.posterPath)}, ${sql(match.runtimeMinutes)}, ${sql(match.tmdbCollectionId)}, ${sql(fetchedAt)}, '1970-01-01T00:00:00.000Z', ${sql(expiresAt)}, 0 FROM movies WHERE movies.id = ${movieId} AND ${condition} ON CONFLICT(movie_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, title = excluded.title, release_date = excluded.release_date, poster_path = excluded.poster_path, runtime_minutes = excluded.runtime_minutes, tmdb_collection_id = excluded.tmdb_collection_id, fetched_at = excluded.fetched_at, refresh_after = excluded.refresh_after, expires_at = excluded.expires_at, data_version = 0;`,
    "DELETE FROM tmdb_collections WHERE NOT EXISTS (SELECT 1 FROM movie_tmdb_data WHERE movie_tmdb_data.tmdb_collection_id = tmdb_collections.tmdb_id);",
  );
  return statements;
};

interface AccumulatedMovie {
  addedAt: string;
  firstSourceRow: number;
  collectionName: string | null;
  id: string;
  legacyImdbId: string | null;
  rating: GeneralizedRating | null;
  sources: Array<GeneralizedSubmission & { sourceKey: string }>;
  title: string;
  titleNormalized: string;
  tmdbMatch: ConfirmedTmdbMatch | null;
}

const ratingKey = (rating: GeneralizedRating | null) =>
  rating ? `${rating.score}\u0000${rating.phrase.trim()}` : null;

export const buildImportPlan = async (
  document: GeneralizedImportDocument,
  importedAt: string,
  reconciliation: TmdbReconciliationDocument | null = null,
): Promise<ImportPlan> => {
  if (
    document.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
    !document.validated ||
    !document.rows.every(isSubmission) ||
    parseSubmissionTimestamp(importedAt) !== importedAt
  ) {
    return {
      counts: { collections: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics: [diagnostic("INTERMEDIATE_SCHEMA_INVALID", null)],
      nowShowingStatus: null,
      statements: [],
    };
  }

  const diagnostics: ImportDiagnostic[] = [];
  const movies = new Map<string, AccumulatedMovie>();
  const duplicateOccurrences = new Map<string, number>();
  const sourceRows = new Set<number>();
  const tmdbMatches = new Map(
    (reconciliation?.matches ?? []).map((match) => [match.legacyImdbId, match]),
  );

  for (const row of document.rows) {
    if (sourceRows.has(row.sourceRow)) {
      diagnostics.push(diagnostic("DUPLICATE_SOURCE_ROW", row.sourceRow));
      continue;
    }
    sourceRows.add(row.sourceRow);
    const fingerprint = JSON.stringify([
      row.submittedAt,
      row.title.trim(),
      row.priorViewed,
      row.collectionIndicated,
      row.collectionName?.trim() ?? null,
      row.legacyImdbId,
      row.rating?.score ?? null,
      row.rating?.phrase.trim() ?? null,
    ]);
    const occurrence = (duplicateOccurrences.get(fingerprint) ?? 0) + 1;
    duplicateOccurrences.set(fingerprint, occurrence);
    const sourceKey = await hash("source", `${fingerprint}\u0000${occurrence}`);
    const titleNormalized = normalize(row.title);
    const collectionName = row.collectionName?.trim() || null;
    const collectionNormalized = normalize(collectionName ?? "");
    const movieKey = row.legacyImdbId
      ? `imdb:${row.legacyImdbId}\u0000title:${titleNormalized}\u0000collection:${collectionNormalized}`
      : `submission:${fingerprint}`;
    const existing = movies.get(movieKey);
    const tmdbMatch = row.legacyImdbId
      ? (tmdbMatches.get(row.legacyImdbId) ?? null)
      : null;

    if (!existing) {
      movies.set(movieKey, {
        addedAt: row.submittedAt,
        firstSourceRow: row.sourceRow,
        collectionName,
        id: await stableId("movie", movieKey),
        legacyImdbId: row.legacyImdbId,
        rating: row.rating,
        sources: [{ ...row, sourceKey }],
        title: row.title.trim(),
        titleNormalized,
        tmdbMatch:
          tmdbMatch?.sourceTitleNormalized === titleNormalized
            ? tmdbMatch
            : null,
      });
      continue;
    }

    if (
      existing.rating &&
      row.rating &&
      ratingKey(existing.rating) !== ratingKey(row.rating)
    ) {
      diagnostics.push(diagnostic("CONFLICTING_RATING", row.sourceRow));
    }

    existing.addedAt =
      row.submittedAt < existing.addedAt ? row.submittedAt : existing.addedAt;
    existing.firstSourceRow = Math.min(existing.firstSourceRow, row.sourceRow);
    if (!existing.rating && row.rating) {
      existing.rating = row.rating;
    }
    existing.sources.push({ ...row, sourceKey });
  }

  const moviesByExternalId = new Map<string, AccumulatedMovie[]>();
  for (const movie of movies.values()) {
    if (!movie.legacyImdbId) continue;
    const matches = moviesByExternalId.get(movie.legacyImdbId) ?? [];
    matches.push(movie);
    moviesByExternalId.set(movie.legacyImdbId, matches);
  }
  for (const matches of moviesByExternalId.values()) {
    if (matches.length < 2) continue;
    for (const movie of matches) {
      diagnostics.push(
        diagnostic("DUPLICATE_EXTERNAL_ID", movie.firstSourceRow, "warning"),
      );
      movie.legacyImdbId = null;
      movie.tmdbMatch = null;
    }
  }

  const usedTmdbMatches = new Set(
    [...movies.values()]
      .map((movie) => movie.tmdbMatch?.legacyImdbId)
      .filter((legacyImdbId): legacyImdbId is string => Boolean(legacyImdbId)),
  );
  for (const legacyImdbId of tmdbMatches.keys()) {
    if (!usedTmdbMatches.has(legacyImdbId)) {
      diagnostics.push(diagnostic("TMDB_MATCH_UNUSED", null));
    }
  }

  const nowShowing =
    document.nowShowingSourceRow === null
      ? null
      : [...movies.values()].find((movie) =>
          movie.sources.some(
            (source) => source.sourceRow === document.nowShowingSourceRow,
          ),
        );
  if (nowShowing?.rating) {
    diagnostics.push(
      diagnostic("NOW_SHOWING_ALREADY_WATCHED", document.nowShowingSourceRow),
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return {
      counts: { collections: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics,
      nowShowingStatus: null,
      statements: [],
    };
  }

  const orderedMovies = [...movies.values()].sort(
    (left, right) =>
      left.firstSourceRow - right.firstSourceRow ||
      left.id.localeCompare(right.id),
  );
  const collectionMap = new Map<
    string,
    {
      id: string;
      name: string;
      movies: AccumulatedMovie[];
      orderConfirmed: boolean;
    }
  >();
  for (const movie of orderedMovies) {
    if (!movie.collectionName) continue;
    const key = normalize(movie.collectionName);
    const collection = collectionMap.get(key) ?? {
      id: await stableId("collection", key),
      movies: [],
      name: movie.collectionName,
      orderConfirmed: false,
    };
    collection.movies.push(movie);
    collectionMap.set(key, collection);
  }

  for (const order of document.collectionOrders) {
    const collection = collectionMap.get(normalize(order.name));
    const orderedMovies = order.sourceRows.map((sourceRow) =>
      collection?.movies.find((movie) =>
        movie.sources.some((source) => source.sourceRow === sourceRow),
      ),
    );
    if (
      !collection ||
      orderedMovies.some((movie) => !movie) ||
      orderedMovies.length !== collection.movies.length ||
      new Set(orderedMovies).size !== collection.movies.length
    ) {
      diagnostics.push(diagnostic("COLLECTION_ORDER_INVALID", null));
      continue;
    }
    collection.movies = orderedMovies as AccumulatedMovie[];
    collection.orderConfirmed = true;
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return {
      counts: { collections: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics,
      nowShowingStatus: null,
      statements: [],
    };
  }

  const statements: string[] = [];
  for (const [nameNormalized, collection] of [
    ...collectionMap.entries(),
  ].sort()) {
    statements.push(
      `INSERT OR IGNORE INTO collections (id, name, name_normalized, order_confirmed, created_at, updated_at) VALUES (${sql(collection.id)}, ${sql(collection.name)}, ${sql(nameNormalized)}, ${collection.orderConfirmed ? 1 : 0}, ${sql(importedAt)}, ${sql(importedAt)});`,
    );
  }

  for (const movie of orderedMovies) {
    statements.push(
      `INSERT OR IGNORE INTO movies (id, title, title_normalized, added_at, updated_at, release_date, poster_path, runtime_minutes, tmdb_id, tmdb_collection_id, tmdb_collection_name, tmdb_fetched_at, imdb_id) VALUES (${sql(movie.id)}, ${sql(movie.title)}, ${sql(movie.titleNormalized)}, ${sql(movie.addedAt)}, ${sql(importedAt)}, ${sql(movie.tmdbMatch?.releaseDate ?? null)}, ${sql(movie.tmdbMatch?.posterPath ?? null)}, ${sql(movie.tmdbMatch?.runtimeMinutes ?? null)}, ${sql(movie.tmdbMatch?.tmdbId ?? null)}, ${sql(movie.tmdbMatch?.tmdbCollectionId ?? null)}, ${sql(movie.tmdbMatch?.tmdbCollectionName ?? null)}, ${sql(movie.tmdbMatch ? (reconciliation?.generatedAt ?? null) : null)}, ${sql(movie.legacyImdbId)});`,
    );
    if (movie.tmdbMatch && reconciliation) {
      statements.push(
        `UPDATE movies SET release_date = ${sql(movie.tmdbMatch.releaseDate)}, poster_path = ${sql(movie.tmdbMatch.posterPath)}, runtime_minutes = ${sql(movie.tmdbMatch.runtimeMinutes)}, tmdb_id = ${movie.tmdbMatch.tmdbId}, tmdb_collection_id = ${sql(movie.tmdbMatch.tmdbCollectionId)}, tmdb_collection_name = ${sql(movie.tmdbMatch.tmdbCollectionName)}, tmdb_fetched_at = ${sql(reconciliation.generatedAt)} WHERE id = ${sql(movie.id)} AND (tmdb_id IS NULL OR tmdb_id = ${movie.tmdbMatch.tmdbId}) AND NOT EXISTS (SELECT 1 FROM movies AS linked WHERE linked.tmdb_id = ${movie.tmdbMatch.tmdbId} AND linked.id <> ${sql(movie.id)});`,
      );
      statements.push(
        ...tmdbDataStatements(
          sql(movie.id),
          movie.tmdbMatch,
          reconciliation.generatedAt,
          `EXISTS (SELECT 1 FROM movies WHERE id = ${sql(movie.id)} AND tmdb_id = ${movie.tmdbMatch.tmdbId})`,
        ),
      );
      statements.push(
        ...tmdbCreditStatements(
          sql(movie.id),
          movie.tmdbMatch,
          reconciliation.generatedAt,
          `EXISTS (SELECT 1 FROM movies WHERE id = ${sql(movie.id)} AND tmdb_id = ${movie.tmdbMatch.tmdbId})`,
        ),
      );
    }
    for (const source of movie.sources.sort(
      (left, right) => left.sourceRow - right.sourceRow,
    )) {
      statements.push(
        `INSERT OR IGNORE INTO movie_import_sources (source_key, movie_id, source_row, submitted_at, prior_viewed, imported_at) VALUES (${sql(source.sourceKey)}, ${sql(movie.id)}, ${source.sourceRow}, ${sql(source.submittedAt)}, ${source.priorViewed ? 1 : 0}, ${sql(importedAt)});`,
      );
    }
  }

  for (const [, collection] of [...collectionMap.entries()].sort()) {
    for (const [index, movie] of collection.movies.entries()) {
      statements.push(
        `INSERT OR IGNORE INTO collection_movies (collection_id, movie_id, position) VALUES (${sql(collection.id)}, ${sql(movie.id)}, ${index + 1});`,
      );
    }
  }

  if (nowShowing) {
    const collection = nowShowing.collectionName
      ? collectionMap.get(normalize(nowShowing.collectionName))
      : null;
    const defaultNowShowing = collection
      ? ((collection.orderConfirmed
          ? collection.movies
          : [...collection.movies].sort(
              (left, right) =>
                left.addedAt.localeCompare(right.addedAt) ||
                left.id.localeCompare(right.id),
            )
        ).find((movie) => !movie.rating) ?? nowShowing)
      : nowShowing;
    statements.push(
      `UPDATE now_showing SET rolled_movie_id = NULL, movie_id = ${sql(defaultNowShowing.id)}, collection_id = ${sql(collection?.id ?? null)}, status = 'ready', rolled_at = NULL, updated_at = ${sql(importedAt)} WHERE id = 1 AND status = 'empty';`,
    );
  }

  for (const movie of orderedMovies) {
    if (!movie.rating) continue;
    statements.push(
      `INSERT OR IGNORE INTO ratings (id, movie_id, recorded_at, watched_at, score, phrase, source) VALUES (${sql(await stableId("rating", movie.id))}, ${sql(movie.id)}, ${sql(importedAt)}, NULL, ${movie.rating.score}, ${sql(movie.rating.phrase.trim())}, 'legacy_import');`,
    );
  }

  return {
    counts: {
      collections: collectionMap.size,
      movies: orderedMovies.length,
      ratings: orderedMovies.filter((movie) => movie.rating).length,
      sources: orderedMovies.reduce(
        (count, movie) => count + movie.sources.length,
        0,
      ),
    },
    diagnostics,
    nowShowingStatus: nowShowing ? "ready" : "empty",
    statements,
  };
};

export const renderSqlChunks = (
  statements: string[],
  statementsPerChunk = 40,
): SqlChunk[] => {
  if (!Number.isInteger(statementsPerChunk) || statementsPerChunk < 1) {
    throw new Error("Chunk size must be a positive integer");
  }

  const chunks: SqlChunk[] = [];
  for (let start = 0; start < statements.length; start += statementsPerChunk) {
    const sequence = chunks.length + 1;
    const body = statements.slice(start, start + statementsPerChunk).join("\n");
    chunks.push({
      filename: `chunk-${String(sequence).padStart(4, "0")}.sql`,
      sql: `PRAGMA foreign_keys = ON;\n${body}\n`,
    });
  }
  return chunks;
};
