import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  INTERMEDIATE_SCHEMA_VERSION,
  type ImportCounts,
  type ImportDiagnostic,
  type SqlChunk,
} from "./import-sheet-lib";

const generatedFilename =
  /^(?:chunk-\d{4}\.sql|manifest\.json|validation-report\.json)$/;

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
  artifactType: "catalog_import" | "tmdb_metadata" = "catalog_import",
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
        artifactType,
        chunks: chunks.map((chunk) => chunk.filename),
        counts,
        importedAt,
        schemaVersion: INTERMEDIATE_SCHEMA_VERSION,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  writeValidationReport(outputDirectory, diagnostics);
};
