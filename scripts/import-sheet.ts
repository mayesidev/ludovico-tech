import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = string[];

const scriptArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
const inputPath =
  scriptArgs[0] ?? "data/Movie List (Responses) - Form Responses 1.csv";
const outputPath = scriptArgs[1] ?? "data/generated-import.sql";
const rows = parse(readFileSync(resolve(inputPath)), {
  skip_empty_lines: true,
  relax_column_count: true,
}) as Row[];
rows.shift();

const sql = (value: string | number | null) => {
  if (value === null) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replaceAll("'", "''")}'`;
};

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const parseDate = (value: string) => {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const parseRating = (value: string) => {
  const match = value.trim().match(/^(0|[1-5](?:\.5)?)(?:\s+(.+))?$/);
  if (!match) return { score: null, phrase: null };
  return { score: Number(match[1]), phrase: match[2]?.trim() || null };
};
const parseImdbId = (value: string) =>
  value.match(/\/title\/(tt\d+)/i)?.[1] ?? null;

const createdAt = new Date().toISOString();
const franchiseIds = new Map<string, string>();
const franchisePositions = new Map<string, number>();
const duplicateKeys = new Set<string>();
const statements: string[] = ["BEGIN TRANSACTION;"];
let imported = 0;
let skipped = 0;

for (const [rowIndex, row] of rows.entries()) {
  const title = row[1]?.trim();
  if (!title) {
    skipped += 1;
    continue;
  }

  const imdbId = parseImdbId(row[5] ?? "");
  const duplicateKey = `${normalize(title)}|${imdbId ?? ""}`;
  if (duplicateKeys.has(duplicateKey)) {
    skipped += 1;
    continue;
  }
  duplicateKeys.add(duplicateKey);

  const franchiseName = row[4]?.trim() || null;
  const franchiseKey = franchiseName ? normalize(franchiseName) : null;
  const franchiseId = franchiseKey
    ? (franchiseIds.get(franchiseKey) ?? randomUUID())
    : null;
  if (franchiseKey && franchiseName && !franchiseIds.has(franchiseKey)) {
    franchiseIds.set(franchiseKey, franchiseId!);
    statements.push(
      `INSERT OR IGNORE INTO franchises (id, name, created_at, updated_at) VALUES (${sql(franchiseId)}, ${sql(franchiseName)}, ${sql(createdAt)}, ${sql(createdAt)})`,
    );
  }
  const position = franchiseKey
    ? (franchisePositions.get(franchiseKey) ?? 0) + 1
    : null;
  if (franchiseKey && position !== null)
    franchisePositions.set(franchiseKey, position);
  const rating = parseRating(row[6] ?? "");
  const movieId = randomUUID();
  const sourceAddedAt = parseDate(row[0] ?? "");

  statements.push(
    `INSERT OR IGNORE INTO movies (id, title, title_normalized, added_at, source_added_at, source_row, updated_at, release_date, imdb_id, franchise_id, prior_viewed, rating_score, rating_phrase, watched_at) VALUES (${sql(movieId)}, ${sql(title)}, ${sql(normalize(title))}, ${sql(sourceAddedAt ?? createdAt)}, ${sql(sourceAddedAt)}, ${rowIndex + 2}, ${sql(createdAt)}, NULL, ${sql(imdbId)}, ${sql(franchiseId)}, ${row[2]?.trim().toLowerCase() === "yes" ? 1 : 0}, ${sql(rating.score)}, ${sql(rating.phrase)}, NULL)`,
  );
  if (franchiseId && position !== null && franchiseName) {
    statements.push(
      `INSERT OR IGNORE INTO franchise_movies (franchise_id, movie_id, position) VALUES (${sql(franchiseId)}, ${sql(movieId)}, ${position})`,
    );
  }
  imported += 1;
}

const bodyStatements = statements.slice(1);
bodyStatements.pop();
const chunkSize = 40;
const basePath = outputPath.replace(/\.sql$/i, "");
let chunkCount = 0;
for (let start = 0; start < bodyStatements.length; start += chunkSize) {
  const chunk = bodyStatements.slice(start, start + chunkSize);
  const chunkPath = `${basePath}-${String(chunkCount + 1).padStart(3, "0")}.sql`;
  writeFileSync(
    resolve(chunkPath),
    `BEGIN TRANSACTION;\n${chunk.join(";\n")};\nCOMMIT;\n`,
  );
  chunkCount += 1;
}
console.log(
  `Prepared ${imported} movies (${skipped} skipped) in ${chunkCount} local SQL chunks`,
);
