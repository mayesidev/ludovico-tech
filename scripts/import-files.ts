import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CATALOG_IMPORT_SCHEMA_VERSION,
  type CatalogImportCounts,
  type CatalogImportDiagnostic,
  type SqlChunk,
} from "./catalog-import-lib";

const generatedFilename =
  /^(?:chunk-\d{4}\.sql|manifest\.json|validation-report\.json)$/;

export const IMPORT_ARTIFACT_SCHEMA_VERSION = 3 as const;

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
  diagnostics: CatalogImportDiagnostic[],
) => {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "validation-report.json"),
    `${JSON.stringify(
      {
        diagnostics,
        schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION,
        valid: diagnostics.length === 0,
      },
      null,
      2,
    )}\n`,
  );
};

export const writeImportArtifacts = (
  outputDirectory: string,
  chunks: SqlChunk[],
  counts: CatalogImportCounts,
  importedAt: string,
  diagnostics: CatalogImportDiagnostic[],
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
        artifactType: "catalog_import",
        chunks: chunks.map((chunk) => ({
          filename: chunk.filename,
          sha256: createHash("sha256").update(chunk.sql).digest("hex"),
        })),
        counts,
        importedAt,
        nowShowingStatus: "empty",
        schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  writeValidationReport(outputDirectory, diagnostics);
};
