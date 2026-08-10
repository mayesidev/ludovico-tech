import { parse } from "csv-parse/sync";

export const INTERMEDIATE_SCHEMA_VERSION = 2 as const;
export const TMDB_RECONCILIATION_SCHEMA_VERSION = 2 as const;

const SOURCE_COLUMN_INDEX = {
  submittedAt: 0,
  title: 1,
  priorViewed: 2,
  franchiseIndicated: 3,
  franchiseName: 4,
  legacyImdbReference: 5,
  rating: 6,
} as const;
const SOURCE_COLUMN_COUNT = Object.keys(SOURCE_COLUMN_INDEX).length;

export type DiagnosticSeverity = "error" | "warning";

export type ImportDiagnosticCode =
  | "CONFLICTING_RATING"
  | "DUPLICATE_EXTERNAL_ID"
  | "DUPLICATE_SOURCE_ROW"
  | "EXTERNAL_ID_CORRECTION_UNUSED"
  | "FRANCHISE_INDICATOR_MISMATCH"
  | "FRANCHISE_INDICATOR_UNCERTAIN"
  | "INTERMEDIATE_SCHEMA_INVALID"
  | "INVALID_FRANCHISE_INDICATOR"
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
  | "TMDB_RECONCILIATION_INVALID";

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
  excludedSourceRows: ReadonlySet<number>;
  legacyImdbIds: ReadonlyMap<number, string>;
  nowShowingSourceRow: number | null;
  ratings: ReadonlyMap<number, RatingCorrection>;
}

const emptyImportCorrections = (): ImportCorrections => ({
  excludedSourceRows: new Set(),
  legacyImdbIds: new Map(),
  nowShowingSourceRow: null,
  ratings: new Map(),
});

export interface GeneralizedSubmission {
  franchiseIndicated: boolean | null;
  franchiseName: string | null;
  legacyImdbId: string | null;
  priorViewed: boolean;
  rating: GeneralizedRating | null;
  sourceRow: number;
  submittedAt: string;
  title: string;
}

export interface GeneralizedImportDocument {
  nowShowingSourceRow: number | null;
  rows: GeneralizedSubmission[];
  schemaVersion: typeof INTERMEDIATE_SCHEMA_VERSION;
  validated: boolean;
}

export interface ConfirmedTmdbMatch {
  legacyImdbId: string;
  posterPath: string | null;
  providerTitleNormalized: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  sourceTitleNormalized: string;
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
  franchises: number;
  movies: number;
  ratings: number;
  sources: number;
}

export interface ImportPlan {
  counts: ImportCounts;
  diagnostics: ImportDiagnostic[];
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
      counts: { franchises: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics: [diagnostic("INTERMEDIATE_SCHEMA_INVALID", null)],
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
  for (const match of reconciliation.matches) {
    const sourceRows = rowsByLegacyId.get(match.legacyImdbId) ?? [];
    const identities = new Set(
      sourceRows.map(
        (row) =>
          `${normalize(row.title)}\u0000${normalize(row.franchiseName ?? "")}`,
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
      `UPDATE movies SET release_date = ${sql(match.releaseDate)}, poster_path = ${sql(match.posterPath)}, runtime_minutes = ${sql(match.runtimeMinutes)}, tmdb_id = ${match.tmdbId}, tmdb_fetched_at = ${sql(reconciliation.generatedAt)}, updated_at = ${sql(appliedAt)} WHERE legacy_imdb_id = ${sql(match.legacyImdbId)} AND title_normalized = ${sql(match.sourceTitleNormalized)} AND (tmdb_id IS NULL OR tmdb_id = ${match.tmdbId}) AND NOT EXISTS (SELECT 1 FROM movies AS linked WHERE linked.tmdb_id = ${match.tmdbId} AND linked.legacy_imdb_id <> ${sql(match.legacyImdbId)});`,
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return {
      counts: { franchises: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics,
      statements: [],
    };
  }
  return {
    counts: {
      franchises: 0,
      movies: statements.length,
      ratings: 0,
      sources: 0,
    },
    diagnostics,
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

const parseFranchiseIndicator = (value: string) => {
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
    /^(0(?:\.0)?|[1-4](?:\.0|\.5)?|5(?:\.0)?)\s*(?:[-–—:]\s*)?(.+)$/,
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
  const trimmed = value.trim();
  if (!trimmed) return { id: null, valid: true };
  const match = trimmed.match(/(?:^|\/title\/)(tt\d{6,9})(?:$|[/?#])/i);
  return match
    ? { id: match[1].toLowerCase(), valid: true }
    : { id: null, valid: false };
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
  const appliedExternalIdCorrections = new Set<number>();
  const appliedRatingCorrections = new Set<number>();

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
    const title = (record[SOURCE_COLUMN_INDEX.title] ?? "").trim();
    const priorViewed = parseBoolean(
      record[SOURCE_COLUMN_INDEX.priorViewed] ?? "",
    );
    const franchiseIndicated = parseFranchiseIndicator(
      record[SOURCE_COLUMN_INDEX.franchiseIndicated] ?? "",
    );
    const franchiseName =
      (record[SOURCE_COLUMN_INDEX.franchiseName] ?? "").trim() || null;
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
    if (franchiseIndicated === undefined) {
      diagnostics.push(diagnostic("INVALID_FRANCHISE_INDICATOR", sourceRow));
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
      franchiseIndicated !== undefined &&
      franchiseIndicated !== null &&
      franchiseIndicated !== Boolean(franchiseName)
    ) {
      diagnostics.push(
        diagnostic("FRANCHISE_INDICATOR_MISMATCH", sourceRow, "warning"),
      );
    }
    if (franchiseIndicated === null) {
      diagnostics.push(
        diagnostic("FRANCHISE_INDICATOR_UNCERTAIN", sourceRow, "warning"),
      );
    }

    if (
      submittedAt &&
      title &&
      priorViewed !== null &&
      franchiseIndicated !== undefined &&
      rating !== undefined
    ) {
      rows.push({
        franchiseIndicated,
        franchiseName,
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
      nowShowingSourceRow: corrections.nowShowingSourceRow,
      rows,
      schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
      validated: !diagnostics.some((item) => item.severity === "error"),
    },
  };
};

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

const isFranchiseIndicator = (value: unknown): value is boolean | null =>
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
        "excludedSourceRows",
        "legacyImdbIds",
        "nowShowingSourceRow",
        "ratings",
        "schemaVersion",
      ]) ||
      value.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
      !Array.isArray(value.excludedSourceRows) ||
      !Array.isArray(value.legacyImdbIds) ||
      !Array.isArray(value.ratings) ||
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
      excludedSourceRows,
      legacyImdbIds,
      nowShowingSourceRow:
        value.nowShowingSourceRow === null
          ? null
          : Number(value.nowShowingSourceRow),
      ratings: corrections,
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
      "franchiseIndicated",
      "franchiseName",
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
    isFranchiseIndicator(row.franchiseIndicated) &&
    isNullableString(row.franchiseName) &&
    (row.franchiseName === null ||
      (row.franchiseName === row.franchiseName.trim() &&
        row.franchiseName.length > 0)) &&
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
        "nowShowingSourceRow",
        "rows",
        "schemaVersion",
        "validated",
      ]) ||
      value.schemaVersion !== INTERMEDIATE_SCHEMA_VERSION ||
      value.validated !== true ||
      !Array.isArray(value.rows) ||
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
    return value as unknown as GeneralizedImportDocument;
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
    for (const item of value.matches) {
      if (!item || typeof item !== "object") return null;
      const match = item as Record<string, unknown>;
      if (
        !hasExactKeys(match, [
          "legacyImdbId",
          "posterPath",
          "providerTitleNormalized",
          "releaseDate",
          "runtimeMinutes",
          "sourceTitleNormalized",
          "tmdbId",
        ]) ||
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

interface AccumulatedMovie {
  addedAt: string;
  firstSourceRow: number;
  franchiseName: string | null;
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
      counts: { franchises: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics: [diagnostic("INTERMEDIATE_SCHEMA_INVALID", null)],
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
      row.franchiseIndicated,
      row.franchiseName?.trim() ?? null,
      row.legacyImdbId,
      row.rating?.score ?? null,
      row.rating?.phrase.trim() ?? null,
    ]);
    const occurrence = (duplicateOccurrences.get(fingerprint) ?? 0) + 1;
    duplicateOccurrences.set(fingerprint, occurrence);
    const sourceKey = await hash("source", `${fingerprint}\u0000${occurrence}`);
    const titleNormalized = normalize(row.title);
    const franchiseName = row.franchiseName?.trim() || null;
    const franchiseNormalized = normalize(franchiseName ?? "");
    const movieKey = row.legacyImdbId
      ? `imdb:${row.legacyImdbId}\u0000title:${titleNormalized}\u0000franchise:${franchiseNormalized}`
      : `submission:${fingerprint}`;
    const existing = movies.get(movieKey);
    const tmdbMatch = row.legacyImdbId
      ? (tmdbMatches.get(row.legacyImdbId) ?? null)
      : null;

    if (!existing) {
      movies.set(movieKey, {
        addedAt: row.submittedAt,
        firstSourceRow: row.sourceRow,
        franchiseName,
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
      counts: { franchises: 0, movies: 0, ratings: 0, sources: 0 },
      diagnostics,
      statements: [],
    };
  }

  const orderedMovies = [...movies.values()].sort(
    (left, right) =>
      left.firstSourceRow - right.firstSourceRow ||
      left.id.localeCompare(right.id),
  );
  const franchiseMap = new Map<
    string,
    { id: string; name: string; movies: AccumulatedMovie[] }
  >();
  for (const movie of orderedMovies) {
    if (!movie.franchiseName) continue;
    const key = normalize(movie.franchiseName);
    const franchise = franchiseMap.get(key) ?? {
      id: await stableId("franchise", key),
      movies: [],
      name: movie.franchiseName,
    };
    franchise.movies.push(movie);
    franchiseMap.set(key, franchise);
  }

  const statements: string[] = [];
  for (const [nameNormalized, franchise] of [
    ...franchiseMap.entries(),
  ].sort()) {
    statements.push(
      `INSERT OR IGNORE INTO franchises (id, name, name_normalized, order_confirmed, created_at, updated_at) VALUES (${sql(franchise.id)}, ${sql(franchise.name)}, ${sql(nameNormalized)}, 0, ${sql(importedAt)}, ${sql(importedAt)});`,
    );
  }

  for (const movie of orderedMovies) {
    statements.push(
      `INSERT OR IGNORE INTO movies (id, title, title_normalized, added_at, updated_at, release_date, poster_path, runtime_minutes, tmdb_id, tmdb_fetched_at, legacy_imdb_id) VALUES (${sql(movie.id)}, ${sql(movie.title)}, ${sql(movie.titleNormalized)}, ${sql(movie.addedAt)}, ${sql(importedAt)}, ${sql(movie.tmdbMatch?.releaseDate ?? null)}, ${sql(movie.tmdbMatch?.posterPath ?? null)}, ${sql(movie.tmdbMatch?.runtimeMinutes ?? null)}, ${sql(movie.tmdbMatch?.tmdbId ?? null)}, ${sql(movie.tmdbMatch ? (reconciliation?.generatedAt ?? null) : null)}, ${sql(movie.legacyImdbId)});`,
    );
    if (movie.tmdbMatch && reconciliation) {
      statements.push(
        `UPDATE movies SET release_date = ${sql(movie.tmdbMatch.releaseDate)}, poster_path = ${sql(movie.tmdbMatch.posterPath)}, runtime_minutes = ${sql(movie.tmdbMatch.runtimeMinutes)}, tmdb_id = ${movie.tmdbMatch.tmdbId}, tmdb_fetched_at = ${sql(reconciliation.generatedAt)}, updated_at = ${sql(importedAt)} WHERE id = ${sql(movie.id)} AND (tmdb_id IS NULL OR tmdb_id = ${movie.tmdbMatch.tmdbId}) AND NOT EXISTS (SELECT 1 FROM movies AS linked WHERE linked.tmdb_id = ${movie.tmdbMatch.tmdbId} AND linked.id <> ${sql(movie.id)});`,
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

  for (const [, franchise] of [...franchiseMap.entries()].sort()) {
    for (const [index, movie] of franchise.movies.entries()) {
      statements.push(
        `INSERT OR IGNORE INTO franchise_movies (franchise_id, movie_id, position) VALUES (${sql(franchise.id)}, ${sql(movie.id)}, ${index + 1});`,
      );
    }
  }

  if (nowShowing) {
    const franchise = nowShowing.franchiseName
      ? franchiseMap.get(normalize(nowShowing.franchiseName))
      : null;
    statements.push(
      `UPDATE now_showing SET rolled_movie_id = NULL, movie_id = ${sql(nowShowing.id)}, franchise_id = ${sql(franchise?.id ?? null)}, status = ${sql(franchise ? "pending_order" : "ready")}, rolled_at = NULL, updated_at = ${sql(importedAt)} WHERE id = 1 AND status = 'empty';`,
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
      franchises: franchiseMap.size,
      movies: orderedMovies.length,
      ratings: orderedMovies.filter((movie) => movie.rating).length,
      sources: orderedMovies.reduce(
        (count, movie) => count + movie.sources.length,
        0,
      ),
    },
    diagnostics,
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
