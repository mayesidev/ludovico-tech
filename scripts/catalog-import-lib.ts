import { parse } from "csv-parse/sync";
import { normalizeTitle } from "../src/shared/normalize-title";

export const CATALOG_IMPORT_COLUMNS = [
  "title",
  "added_at",
  "rating_score",
  "rating_phrase",
  "collection",
  "collection_position",
  "tmdb_id",
  "now_showing",
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
  | "INVALID_NOW_SHOWING"
  | "INVALID_RATING"
  | "INVALID_TMDB_ID"
  | "INVALID_TITLE"
  | "MULTIPLE_NOW_SHOWING"
  | "ROW_COLUMN_COUNT"
  | "TEMPLATE_DUPLICATE_COLUMN"
  | "TEMPLATE_MISSING_TITLE"
  | "TEMPLATE_UNKNOWN_COLUMN"
  | "WATCHED_NOW_SHOWING";

export interface CatalogImportDiagnostic {
  code: CatalogImportDiagnosticCode;
  row: number | null;
  severity: "error";
}

export interface CatalogImportRating {
  phrase: string;
  score: number;
}

export interface CatalogImportMovie {
  addedAt: string | null;
  collection: string | null;
  collectionPosition: number | null;
  rating: CatalogImportRating | null;
  title: string;
  tmdbId: number | null;
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
  nowShowing: {
    collectionId: string | null;
    movieId: string;
  } | null;
  statements: string[];
}

export interface CatalogCsvResult {
  diagnostics: CatalogImportDiagnostic[];
  movies: CatalogImportMovie[];
  nowShowingTitle: string | null;
}

const diagnostic = (
  code: CatalogImportDiagnosticCode,
  row: number | null,
): CatalogImportDiagnostic => ({ code, row, severity: "error" });

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const isIsoTimestamp = (value: string) => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const parseRating = (
  scoreSource: string,
  phraseSource: string,
): CatalogImportRating | null | undefined => {
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

const parseNowShowing = (value: string) => {
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  return null;
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
      movies: [],
      nowShowingTitle: null,
    };
  }

  if (records.length === 0) {
    return {
      diagnostics: [diagnostic("IMPORT_EMPTY", null)],
      movies: [],
      nowShowingTitle: null,
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

  const parsedRows: Array<{
    movie: CatalogImportMovie;
    nowShowing: boolean;
    row: number;
  }> = [];
  for (const [index, record] of records.slice(1).entries()) {
    const row = index + 2;
    if (record.length !== headers.length) {
      diagnostics.push(diagnostic("ROW_COLUMN_COUNT", row));
      continue;
    }

    const title = columnValue(record, columns, "title").trim();
    const normalizedTitle = normalizeTitle(title);
    const addedAtSource = columnValue(record, columns, "added_at").trim();
    const addedAt =
      addedAtSource && isIsoTimestamp(addedAtSource) ? addedAtSource : null;
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
    const nowShowingSource = columnValue(record, columns, "now_showing").trim();
    const nowShowing = parseNowShowing(nowShowingSource);

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
      (collection.length > 200 || !normalizeTitle(collection))
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
    if (nowShowing === null) {
      diagnostics.push(diagnostic("INVALID_NOW_SHOWING", row));
      valid = false;
    }

    if (valid && rating !== undefined && nowShowing !== null) {
      parsedRows.push({
        movie: {
          addedAt,
          collection,
          collectionPosition,
          rating,
          title,
          tmdbId,
        },
        nowShowing,
        row,
      });
    }
  }

  const uniqueTitleRows = new Map<string, number>();
  const uniqueTmdbRows = new Map<number, number>();
  for (const { movie, row } of parsedRows) {
    const normalizedTitle = normalizeTitle(movie.title);
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
    Array<{ movie: CatalogImportMovie; row: number }>
  >();
  for (const parsedRow of parsedRows) {
    if (!parsedRow.movie.collection) continue;
    const key = normalizeTitle(parsedRow.movie.collection);
    const members = collections.get(key) ?? [];
    members.push(parsedRow);
    collections.set(key, members);
  }

  const nowShowingRows = parsedRows.filter(({ nowShowing }) => nowShowing);
  if (nowShowingRows.length > 1) {
    for (const { row } of nowShowingRows) {
      diagnostics.push(diagnostic("MULTIPLE_NOW_SHOWING", row));
    }
  }
  for (const { movie, row } of nowShowingRows) {
    if (movie.rating) {
      diagnostics.push(diagnostic("WATCHED_NOW_SHOWING", row));
    }
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
    movies: parsedRows.map(({ movie }) => movie),
    nowShowingTitle: nowShowingRows[0]?.movie.title ?? null,
  };
};

const sql = (value: string | number | null) => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

const MAX_INSERT_ROWS = 250;
const MAX_INSERT_BYTES = 90_000;
const sqlBytes = (value: string) => new TextEncoder().encode(value).byteLength;

const batchedInsert = (table: string, columns: string[], rows: string[]) => {
  const prefix = `INSERT INTO ${table} (${columns.join(", ")}) VALUES `;
  const statements: string[] = [];
  let batch: string[] = [];
  for (const row of rows) {
    const candidate = `${prefix}${[...batch, row].join(", ")};`;
    if (
      batch.length > 0 &&
      (batch.length === MAX_INSERT_ROWS ||
        sqlBytes(candidate) > MAX_INSERT_BYTES)
    ) {
      statements.push(`${prefix}${batch.join(", ")};`);
      batch = [];
    }
    if (sqlBytes(`${prefix}${row};`) > MAX_INSERT_BYTES) {
      throw new Error(`A ${table} import row exceeds the SQL statement limit`);
    }
    batch.push(row);
  }
  if (batch.length > 0) {
    statements.push(`${prefix}${batch.join(", ")};`);
  }
  return statements;
};

export const buildCatalogImportPlan = (
  moviesToImport: CatalogImportMovie[],
  nowShowingTitle: string | null,
  importedAt: string,
): CatalogImportPlan => {
  if (!isIsoTimestamp(importedAt)) throw new Error("Invalid import time");

  const movies = [...moviesToImport].sort((left, right) =>
    compareText(normalizeTitle(left.title), normalizeTitle(right.title)),
  );
  const selectedMovie = nowShowingTitle
    ? (movies.find(
        (movie) =>
          normalizeTitle(movie.title) === normalizeTitle(nowShowingTitle),
      ) ?? null)
    : null;
  if (
    (nowShowingTitle !== null && selectedMovie === null) ||
    selectedMovie?.rating
  ) {
    throw new Error("Invalid Now Showing selection");
  }
  const movieIds = new Map<string, string>();
  for (const movie of movies) {
    const identity = normalizeTitle(movie.title);
    movieIds.set(identity, crypto.randomUUID());
  }

  const collections = new Map<
    string,
    {
      id: string;
      members: CatalogImportMovie[];
      name: string;
      orderConfirmed: boolean;
    }
  >();
  for (const movie of movies) {
    if (!movie.collection) continue;
    const normalized = normalizeTitle(movie.collection);
    const collection = collections.get(normalized) ?? {
      id: crypto.randomUUID(),
      members: [],
      name: movie.collection,
      orderConfirmed: movie.collectionPosition !== null,
    };
    collection.members.push(movie);
    collections.set(normalized, collection);
  }

  const statements: string[] = [];
  const collectionRows = [...collections.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(
      ([normalized, collection]) =>
        `(${sql(collection.id)}, ${sql(collection.name)}, ${sql(normalized)}, ${collection.orderConfirmed ? 1 : 0}, ${sql(importedAt)}, ${sql(importedAt)})`,
    );
  statements.push(
    ...batchedInsert(
      "collections",
      [
        "id",
        "name",
        "name_normalized",
        "order_confirmed",
        "created_at",
        "updated_at",
      ],
      collectionRows,
    ),
  );

  const movieRows: string[] = [];
  const tmdbRows: string[] = [];
  for (const movie of movies) {
    const movieId = movieIds.get(normalizeTitle(movie.title)) as string;
    movieRows.push(
      `(${sql(movieId)}, ${sql(movie.title)}, ${sql(movie.addedAt ?? importedAt)})`,
    );
    if (movie.tmdbId !== null) {
      tmdbRows.push(
        `(${sql(movieId)}, ${movie.tmdbId}, '1970-01-01T00:00:00.000Z')`,
      );
    }
  }
  statements.push(
    ...batchedInsert("movies", ["id", "title", "added_at"], movieRows),
    ...batchedInsert(
      "movie_tmdb_data",
      ["movie_id", "tmdb_id", "refresh_after"],
      tmdbRows,
    ),
  );

  const membershipRows: string[] = [];
  for (const [, collection] of [...collections.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const members = [...collection.members].sort((left, right) =>
      collection.orderConfirmed
        ? (left.collectionPosition as number) -
          (right.collectionPosition as number)
        : compareText(normalizeTitle(left.title), normalizeTitle(right.title)),
    );
    for (const [index, movie] of members.entries()) {
      membershipRows.push(
        `(${sql(collection.id)}, ${sql(movieIds.get(normalizeTitle(movie.title)) as string)}, ${index + 1})`,
      );
    }
  }
  statements.push(
    ...batchedInsert(
      "collection_movies",
      ["collection_id", "movie_id", "position"],
      membershipRows,
    ),
  );

  const ratingRows: string[] = [];
  for (const movie of movies) {
    if (!movie.rating) continue;
    const movieId = movieIds.get(normalizeTitle(movie.title)) as string;
    ratingRows.push(
      `(${sql(movieId)}, NULL, ${movie.rating.score}, ${sql(movie.rating.phrase)})`,
    );
  }
  statements.push(
    ...batchedInsert(
      "ratings",
      ["movie_id", "watched_at", "score", "phrase"],
      ratingRows,
    ),
  );

  const selectedMovieId = selectedMovie
    ? (movieIds.get(normalizeTitle(selectedMovie.title)) as string)
    : null;
  const selectedCollectionId = selectedMovie?.collection
    ? (collections.get(normalizeTitle(selectedMovie.collection))?.id ?? null)
    : null;
  if (selectedMovieId) {
    statements.push(
      `UPDATE now_showing SET rolled_movie_id = NULL, movie_id = ${sql(selectedMovieId)}, collection_id = ${sql(selectedCollectionId)}, status = 'ready', rolled_at = NULL, updated_at = ${sql(importedAt)} WHERE id = 1;`,
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
    nowShowing: selectedMovieId
      ? { collectionId: selectedCollectionId, movieId: selectedMovieId }
      : null,
    statements,
  };
};

export const renderSqlChunks = (
  statements: string[],
  statementsPerChunk = 40,
): string[] => {
  if (!Number.isInteger(statementsPerChunk) || statementsPerChunk < 1) {
    throw new Error("Chunk size must be a positive integer");
  }
  const chunks: string[] = [];
  for (let start = 0; start < statements.length; start += statementsPerChunk) {
    chunks.push(
      `PRAGMA foreign_keys = ON;\n${statements.slice(start, start + statementsPerChunk).join("\n")}\n`,
    );
  }
  return chunks;
};
