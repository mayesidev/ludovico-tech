import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  INTERMEDIATE_SCHEMA_VERSION,
  type ImportCounts,
  type ImportDiagnostic,
  type SqlChunk,
} from "./import-sheet-lib";

const generatedFilename =
  /^(?:chunk-\d{4}\.sql|manifest\.json|validation-report\.json)$/;

export const IMPORT_ARTIFACT_SCHEMA_VERSION = 1 as const;

type ImportArtifactOptions =
  | {
      artifactType: "catalog_import";
      nowShowingStatus: "empty" | "pending_order" | "ready";
    }
  | {
      artifactType: "tmdb_metadata";
      nowShowingStatus: null;
    };

export const clearGeneratedImportFiles = (outputDirectory: string) => {
  if (!existsSync(outputDirectory)) return;
  for (const filename of readdirSync(outputDirectory)) {
    if (generatedFilename.test(filename)) {
      rmSync(join(outputDirectory, filename));
    }
  }
};

export const writeValidationReport = (
  outputDirectory: string,
  diagnostics: ImportDiagnostic[],
) => {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "validation-report.json"),
    `${JSON.stringify(
      {
        diagnostics,
        schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
        valid: !diagnostics.some((item) => item.severity === "error"),
      },
      null,
      2,
    )}\n`,
  );
};

export const writeImportArtifacts = (
  outputDirectory: string,
  chunks: SqlChunk[],
  counts: ImportCounts,
  importedAt: string,
  diagnostics: ImportDiagnostic[],
  options: ImportArtifactOptions,
) => {
  mkdirSync(outputDirectory, { recursive: true });
  clearGeneratedImportFiles(outputDirectory);

  for (const chunk of chunks) {
    writeFileSync(join(outputDirectory, chunk.filename), chunk.sql, {
      flag: "wx",
    });
  }

  writeFileSync(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        artifactSchemaVersion: IMPORT_ARTIFACT_SCHEMA_VERSION,
        artifactType: options.artifactType,
        chunks: chunks.map((chunk) => ({
          filename: chunk.filename,
          sha256: createHash("sha256").update(chunk.sql).digest("hex"),
        })),
        counts,
        importedAt,
        nowShowingStatus: options.nowShowingStatus,
        schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  writeValidationReport(outputDirectory, diagnostics);
};
