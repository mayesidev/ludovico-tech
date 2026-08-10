import {
  normalizeCatalogText,
  TMDB_RECONCILIATION_SCHEMA_VERSION,
  type ConfirmedTmdbMatch,
  type GeneralizedImportDocument,
} from "./import-sheet-lib";

export type TmdbFindMovie = {
  id: number;
  posterPath: string | null;
  releaseDate: string | null;
  title: string;
};

export type TmdbReconciliationDiagnosticCode =
  | "DUPLICATE_EXTERNAL_ID"
  | "DUPLICATE_TMDB_ID"
  | "LOOKUP_FAILED"
  | "MULTIPLE_MATCHES"
  | "NO_MATCH"
  | "TITLE_CONFLICT";

export type TmdbReconciliationDiagnostic = {
  code: TmdbReconciliationDiagnosticCode;
  sourceRows: number[];
};

export type TmdbReconciliationResult = {
  diagnostics: TmdbReconciliationDiagnostic[];
  document: {
    complete: boolean;
    generatedAt: string;
    matches: ConfirmedTmdbMatch[];
    schemaVersion: typeof TMDB_RECONCILIATION_SCHEMA_VERSION;
  };
};

export type FindTmdbMovies = (legacyImdbId: string) => Promise<TmdbFindMovie[]>;

const mapProviderMovie = (value: unknown): TmdbFindMovie | null => {
  if (!value || typeof value !== "object") return null;
  const movie = value as Record<string, unknown>;
  if (
    !Number.isInteger(movie.id) ||
    Number(movie.id) <= 0 ||
    typeof movie.title !== "string" ||
    !movie.title.trim()
  ) {
    return null;
  }
  return {
    id: Number(movie.id),
    posterPath:
      typeof movie.poster_path === "string" &&
      /^\/[A-Za-z0-9._-]{1,200}$/.test(movie.poster_path)
        ? movie.poster_path
        : null,
    releaseDate:
      typeof movie.release_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(movie.release_date)
        ? movie.release_date
        : null,
    title: movie.title.trim().slice(0, 200),
  };
};

export const parseTmdbFindResponse = (
  value: unknown,
): TmdbFindMovie[] | null => {
  if (!value || typeof value !== "object") return null;
  const movieResults = (value as Record<string, unknown>).movie_results;
  if (!Array.isArray(movieResults)) return null;
  const movies = movieResults.map(mapProviderMovie);
  return movies.every((movie): movie is TmdbFindMovie => movie !== null)
    ? movies
    : null;
};

const identityKey = (title: string, franchiseName: string | null) =>
  `${normalizeCatalogText(title)}\u0000${normalizeCatalogText(franchiseName ?? "")}`;

export const reconcileTmdb = async (
  source: GeneralizedImportDocument,
  findMovies: FindTmdbMovies,
  generatedAt: string,
): Promise<TmdbReconciliationResult> => {
  const groups = new Map<
    string,
    Array<GeneralizedImportDocument["rows"][number]>
  >();
  for (const row of source.rows) {
    if (!row.legacyImdbId) continue;
    const rows = groups.get(row.legacyImdbId) ?? [];
    rows.push(row);
    groups.set(row.legacyImdbId, rows);
  }

  const diagnostics: TmdbReconciliationDiagnostic[] = [];
  const matches: ConfirmedTmdbMatch[] = [];
  let complete = true;

  for (const [, rows] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sourceRows = rows.map((row) => row.sourceRow).sort((a, b) => a - b);
    const identities = new Set(
      rows.map((row) => identityKey(row.title, row.franchiseName)),
    );
    if (identities.size !== 1) {
      diagnostics.push({ code: "DUPLICATE_EXTERNAL_ID", sourceRows });
      continue;
    }

    let providerMovies: TmdbFindMovie[];
    try {
      providerMovies = await findMovies(rows[0].legacyImdbId!);
    } catch {
      diagnostics.push({ code: "LOOKUP_FAILED", sourceRows });
      complete = false;
      break;
    }

    if (providerMovies.length === 0) {
      diagnostics.push({ code: "NO_MATCH", sourceRows });
      continue;
    }
    if (providerMovies.length !== 1) {
      diagnostics.push({ code: "MULTIPLE_MATCHES", sourceRows });
      continue;
    }

    const sourceTitleNormalized = normalizeCatalogText(rows[0].title);
    const providerTitleNormalized = normalizeCatalogText(
      providerMovies[0].title,
    );
    if (providerTitleNormalized !== sourceTitleNormalized) {
      diagnostics.push({ code: "TITLE_CONFLICT", sourceRows });
      continue;
    }

    matches.push({
      legacyImdbId: rows[0].legacyImdbId!,
      posterPath: providerMovies[0].posterPath,
      providerTitleNormalized,
      releaseDate: providerMovies[0].releaseDate,
      sourceTitleNormalized,
      tmdbId: providerMovies[0].id,
    });
  }

  const matchesByTmdbId = new Map<number, ConfirmedTmdbMatch[]>();
  for (const match of matches) {
    const collisions = matchesByTmdbId.get(match.tmdbId) ?? [];
    collisions.push(match);
    matchesByTmdbId.set(match.tmdbId, collisions);
  }
  const conflictingLegacyIds = new Set<string>();
  for (const collisions of matchesByTmdbId.values()) {
    if (collisions.length < 2) continue;
    for (const match of collisions) {
      conflictingLegacyIds.add(match.legacyImdbId);
      diagnostics.push({
        code: "DUPLICATE_TMDB_ID",
        sourceRows: (groups.get(match.legacyImdbId) ?? [])
          .map((row) => row.sourceRow)
          .sort((a, b) => a - b),
      });
    }
  }

  return {
    diagnostics,
    document: {
      complete,
      generatedAt,
      matches: matches
        .filter((match) => !conflictingLegacyIds.has(match.legacyImdbId))
        .sort((left, right) =>
          left.legacyImdbId.localeCompare(right.legacyImdbId),
        ),
      schemaVersion: TMDB_RECONCILIATION_SCHEMA_VERSION,
    },
  };
};
