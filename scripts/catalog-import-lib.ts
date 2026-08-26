import { parse } from "csv-parse/sync";

export const CATALOG_IMPORT_SCHEMA_VERSION = 1 as const;

export const CATALOG_IMPORT_COLUMNS = [
  "title",
  "added_at",
  "rating_score",
  "rating_phrase",
  "collection",
  "collection_position",
  "tmdb_id",
] as const;

type CatalogImportColumn = (typeof CATALOG_IMPORT_COLUMNS)[number];

export type CatalogImportDiagnosticCode =
  | "COLLECTION_ORDER_INCOMPLETE"
  | "DUPLICATE_COLLECTION_POSITION"
  | "DUPLICATE_TMDB_ID"
  | "DUPLICATE_TITLE"
  | "IMPORT_CSV_INVALID"
  | "IMPORT_EMPTY"
  | "INVALID_ADDED_AT"
  | "INVALID_COLLECTION"
  | "INVALID_COLLECTION_POSITION"
  | "INVALID_RATING"
  | "INVALID_TMDB_ID"
  | "INVALID_TITLE"
  | "ROW_COLUMN_COUNT"
  | "TEMPLATE_DUPLICATE_COLUMN"
  | "TEMPLATE_MISSING_TITLE"
  | "TEMPLATE_UNKNOWN_COLUMN";

export interface CatalogImportDiagnostic {
  code: CatalogImportDiagnosticCode;
  row: number | null;
  severity: "error";
}

export interface CatalogRatingSeed {
  phrase: string;
  score: number;
}

export interface CatalogMovieSeed {
  addedAt: string | null;
  collection: string | null;
  collectionPosition: number | null;
  rating: CatalogRatingSeed | null;
  title: string;
  tmdbId: number | null;
}

export interface CatalogSeed {
  movies: CatalogMovieSeed[];
  schemaVersion: typeof CATALOG_IMPORT_SCHEMA_VERSION;
}

export interface CatalogImportCounts {
  collectionMemberships: number;
  collections: number;
  movies: number;
  ratings: number;
  tmdbLinks: number;
}

export interface CatalogImportPlan {
  counts: CatalogImportCounts;
  diagnostics: CatalogImportDiagnostic[];
  statements: string[];
}

export interface CatalogCsvResult {
  diagnostics: CatalogImportDiagnostic[];
  seed: CatalogSeed;
}

export interface SqlChunk {
  filename: string;
  sql: string;
}

const emptyCounts = (): CatalogImportCounts => ({
  collectionMemberships: 0,
  collections: 0,
  movies: 0,
  ratings: 0,
  tmdbLinks: 0,
});

const diagnostic = (
  code: CatalogImportDiagnosticCode,
  row: number | null,
): CatalogImportDiagnostic => ({ code, row, severity: "error" });

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const normalizeCatalogText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseIsoTimestamp = (value: string) => {
  try {
    return new Date(value).toISOString() === value ? value : null;
  } catch {
    return null;
  }
};

const parseRating = (
  scoreSource: string,
  phraseSource: string,
): CatalogRatingSeed | null | undefined => {
  const scoreValue = scoreSource.trim();
  const phrase = phraseSource.trim();
  if (!scoreValue && !phrase) return null;
  if (!scoreValue || !phrase || phrase.length > 120) return undefined;
  const score = Number(scoreValue);
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 5 ||
    score * 2 !== Math.trunc(score * 2)
  ) {
    return undefined;
  }
  return { phrase, score };
};

const parsePositiveInteger = (value: string) => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const columnValue = (
  record: string[],
  columns: ReadonlyMap<CatalogImportColumn, number>,
  column: CatalogImportColumn,
) => {
  const index = columns.get(column);
  return index === undefined ? "" : (record[index] ?? "");
};

export const parseCatalogCsv = (source: string): CatalogCsvResult => {
  let records: string[][];
  try {
    records = parse(source, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];
  } catch {
    return {
      diagnostics: [diagnostic("IMPORT_CSV_INVALID", null)],
      seed: { movies: [], schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION },
    };
  }

  if (records.length === 0) {
    return {
      diagnostics: [diagnostic("IMPORT_EMPTY", null)],
      seed: { movies: [], schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION },
    };
  }

  const diagnostics: CatalogImportDiagnostic[] = [];
  const headers = records[0].map((header) => header.trim());
  const knownColumns = new Set<string>(CATALOG_IMPORT_COLUMNS);
  const columns = new Map<CatalogImportColumn, number>();
  for (const [index, header] of headers.entries()) {
    if (!knownColumns.has(header)) {
      diagnostics.push(diagnostic("TEMPLATE_UNKNOWN_COLUMN", 1));
      continue;
    }
    const column = header as CatalogImportColumn;
    if (columns.has(column)) {
      diagnostics.push(diagnostic("TEMPLATE_DUPLICATE_COLUMN", 1));
      continue;
    }
    columns.set(column, index);
  }
  if (!columns.has("title")) {
    diagnostics.push(diagnostic("TEMPLATE_MISSING_TITLE", 1));
  }

  const parsedRows: Array<{ movie: CatalogMovieSeed; row: number }> = [];
  for (const [index, record] of records.slice(1).entries()) {
    const row = index + 2;
    if (record.length !== headers.length) {
      diagnostics.push(diagnostic("ROW_COLUMN_COUNT", row));
      continue;
    }

    const title = columnValue(record, columns, "title").trim();
    const normalizedTitle = normalizeCatalogText(title);
    const addedAtSource = columnValue(record, columns, "added_at").trim();
    const addedAt = addedAtSource ? parseIsoTimestamp(addedAtSource) : null;
    const rating = parseRating(
      columnValue(record, columns, "rating_score"),
      columnValue(record, columns, "rating_phrase"),
    );
    const collectionSource = columnValue(record, columns, "collection");
    const collection = collectionSource.trim() || null;
    const collectionPositionSource = columnValue(
      record,
      columns,
      "collection_position",
    ).trim();
    const collectionPosition = collectionPositionSource
      ? parsePositiveInteger(collectionPositionSource)
      : null;
    const tmdbIdSource = columnValue(record, columns, "tmdb_id").trim();
    const tmdbId = tmdbIdSource ? parsePositiveInteger(tmdbIdSource) : null;

    let valid = true;
    if (!title || title.length > 200 || !normalizedTitle) {
      diagnostics.push(diagnostic("INVALID_TITLE", row));
      valid = false;
    }
    if (addedAtSource && !addedAt) {
      diagnostics.push(diagnostic("INVALID_ADDED_AT", row));
      valid = false;
    }
    if (rating === undefined) {
      diagnostics.push(diagnostic("INVALID_RATING", row));
      valid = false;
    }
    if (
      collection &&
      (collection.length > 200 || !normalizeCatalogText(collection))
    ) {
      diagnostics.push(diagnostic("INVALID_COLLECTION", row));
      valid = false;
    }
    if (
      collectionPositionSource &&
      (!collectionPosition || collection === null)
    ) {
      diagnostics.push(diagnostic("INVALID_COLLECTION_POSITION", row));
      valid = false;
    }
    if (tmdbIdSource && !tmdbId) {
      diagnostics.push(diagnostic("INVALID_TMDB_ID", row));
      valid = false;
    }

    if (valid && rating !== undefined) {
      parsedRows.push({
        movie: {
          addedAt,
          collection,
          collectionPosition,
          rating,
          title,
          tmdbId,
        },
        row,
      });
    }
  }

  const uniqueTitleRows = new Map<string, number>();
  const uniqueTmdbRows = new Map<number, number>();
  for (const { movie, row } of parsedRows) {
    const normalizedTitle = normalizeCatalogText(movie.title);
    if (uniqueTitleRows.has(normalizedTitle)) {
      diagnostics.push(diagnostic("DUPLICATE_TITLE", row));
    } else {
      uniqueTitleRows.set(normalizedTitle, row);
    }
    if (movie.tmdbId !== null) {
      if (uniqueTmdbRows.has(movie.tmdbId)) {
        diagnostics.push(diagnostic("DUPLICATE_TMDB_ID", row));
      } else {
        uniqueTmdbRows.set(movie.tmdbId, row);
      }
    }
  }

  const collections = new Map<
    string,
    Array<{ movie: CatalogMovieSeed; row: number }>
  >();
  for (const parsedRow of parsedRows) {
    if (!parsedRow.movie.collection) continue;
    const key = normalizeCatalogText(parsedRow.movie.collection);
    const members = collections.get(key) ?? [];
    members.push(parsedRow);
    collections.set(key, members);
  }
  for (const members of collections.values()) {
    const positioned = members.filter(
      ({ movie }) => movie.collectionPosition !== null,
    );
    if (positioned.length > 0 && positioned.length !== members.length) {
      for (const { row } of members) {
        diagnostics.push(diagnostic("COLLECTION_ORDER_INCOMPLETE", row));
      }
      continue;
    }
    if (positioned.length === 0) continue;
    const positions = new Set<number>();
    for (const { movie, row } of positioned) {
      if (positions.has(movie.collectionPosition as number)) {
        diagnostics.push(diagnostic("DUPLICATE_COLLECTION_POSITION", row));
      }
      positions.add(movie.collectionPosition as number);
    }
    if (
      positions.size !== members.length ||
      [...positions].some((position) => position > members.length)
    ) {
      for (const { row } of members) {
        diagnostics.push(diagnostic("COLLECTION_ORDER_INCOMPLETE", row));
      }
    }
  }

  if (parsedRows.length === 0 && diagnostics.length === 0) {
    diagnostics.push(diagnostic("IMPORT_EMPTY", null));
  }

  return {
    diagnostics,
    seed: {
      movies: parsedRows.map(({ movie }) => movie),
      schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION,
    },
  };
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
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

export const buildCatalogImportPlan = async (
  seed: CatalogSeed,
  importedAt: string,
): Promise<CatalogImportPlan> => {
  if (
    seed.schemaVersion !== CATALOG_IMPORT_SCHEMA_VERSION ||
    !parseIsoTimestamp(importedAt)
  ) {
    return {
      counts: emptyCounts(),
      diagnostics: [diagnostic("INVALID_ADDED_AT", null)],
      statements: [],
    };
  }

  const movies = [...seed.movies].sort((left, right) =>
    compareText(
      normalizeCatalogText(left.title),
      normalizeCatalogText(right.title),
    ),
  );
  const movieIds = new Map<string, string>();
  for (const movie of movies) {
    const identity = normalizeCatalogText(movie.title);
    movieIds.set(identity, await stableId("movie", identity));
  }

  const collections = new Map<
    string,
    {
      id: string;
      members: CatalogMovieSeed[];
      name: string;
      orderConfirmed: boolean;
    }
  >();
  for (const movie of movies) {
    if (!movie.collection) continue;
    const normalized = normalizeCatalogText(movie.collection);
    const collection = collections.get(normalized) ?? {
      id: await stableId("collection", normalized),
      members: [],
      name: movie.collection,
      orderConfirmed: movie.collectionPosition !== null,
    };
    collection.members.push(movie);
    collections.set(normalized, collection);
  }

  const statements: string[] = [];
  for (const [normalized, collection] of [...collections.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    statements.push(
      `INSERT OR IGNORE INTO collections (id, name, name_normalized, order_confirmed, created_at, updated_at) VALUES (${sql(collection.id)}, ${sql(collection.name)}, ${sql(normalized)}, ${collection.orderConfirmed ? 1 : 0}, ${sql(importedAt)}, ${sql(importedAt)});`,
    );
  }
  for (const movie of movies) {
    const movieId = movieIds.get(normalizeCatalogText(movie.title)) as string;
    statements.push(
      `INSERT OR IGNORE INTO movies (id, title, title_normalized, added_at, updated_at) VALUES (${sql(movieId)}, ${sql(movie.title)}, ${sql(normalizeCatalogText(movie.title))}, ${sql(movie.addedAt ?? importedAt)}, ${sql(importedAt)});`,
    );
    if (movie.tmdbId !== null) {
      statements.push(
        `INSERT OR IGNORE INTO movie_tmdb_data (movie_id, tmdb_id, refresh_after) VALUES (${sql(movieId)}, ${movie.tmdbId}, '1970-01-01T00:00:00.000Z');`,
      );
    }
  }
  for (const [, collection] of [...collections.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const members = [...collection.members].sort((left, right) =>
      collection.orderConfirmed
        ? (left.collectionPosition as number) -
          (right.collectionPosition as number)
        : compareText(
            normalizeCatalogText(left.title),
            normalizeCatalogText(right.title),
          ),
    );
    for (const [index, movie] of members.entries()) {
      statements.push(
        `INSERT OR IGNORE INTO collection_movies (collection_id, movie_id, position) VALUES (${sql(collection.id)}, ${sql(movieIds.get(normalizeCatalogText(movie.title)) as string)}, ${index + 1});`,
      );
    }
  }
  for (const movie of movies) {
    if (!movie.rating) continue;
    const movieId = movieIds.get(normalizeCatalogText(movie.title)) as string;
    statements.push(
      `INSERT OR IGNORE INTO ratings (id, movie_id, recorded_at, watched_at, score, phrase, source) VALUES (${sql(await stableId("rating", movieId))}, ${sql(movieId)}, ${sql(importedAt)}, NULL, ${movie.rating.score}, ${sql(movie.rating.phrase)}, 'legacy_import');`,
    );
  }

  return {
    counts: {
      collectionMemberships: movies.filter((movie) => movie.collection).length,
      collections: collections.size,
      movies: movies.length,
      ratings: movies.filter((movie) => movie.rating).length,
      tmdbLinks: movies.filter((movie) => movie.tmdbId !== null).length,
    },
    diagnostics: [],
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
    chunks.push({
      filename: `chunk-${String(sequence).padStart(4, "0")}.sql`,
      sql: `PRAGMA foreign_keys = ON;\n${statements.slice(start, start + statementsPerChunk).join("\n")}\n`,
    });
  }
  return chunks;
};
