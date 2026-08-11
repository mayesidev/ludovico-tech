import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildTmdbMetadataPlan,
  parseIntermediateJson,
  parseTmdbReconciliationJson,
  renderSqlChunks,
  type ImportDiagnostic,
} from "./import-sheet-lib";
import {
  clearGeneratedImportFiles,
  writeImportArtifacts,
  writeValidationReport,
} from "./import-files";

const [inputArgument, reconciliationArgument, outputArgument, appliedAt] =
  process.argv.slice(2).filter((argument) => argument !== "--");

if (
  !inputArgument ||
  !reconciliationArgument ||
  !outputArgument ||
  !appliedAt
) {
  console.error(
    "Usage: pnpm import:metadata -- <intermediate.json> <reconciliation.json> <output-directory> <applied-at-iso>",
  );
  process.exitCode = 2;
} else {
  const outputDirectory = resolve(outputArgument);
  const document = parseIntermediateJson(
    readFileSync(resolve(inputArgument), "utf8"),
  );
  const reconciliation = parseTmdbReconciliationJson(
    readFileSync(resolve(reconciliationArgument), "utf8"),
  );
  let diagnostics: ImportDiagnostic[];

  if (!document || !reconciliation) {
    diagnostics = [
      {
        code: !document
          ? "INTERMEDIATE_SCHEMA_INVALID"
          : "TMDB_RECONCILIATION_INVALID",
        row: null,
        severity: "error",
      },
    ];
  } else {
    const plan = buildTmdbMetadataPlan(document, reconciliation, appliedAt);
    diagnostics = plan.diagnostics;
    if (!diagnostics.some((item) => item.severity === "error")) {
      const chunks = renderSqlChunks(plan.statements);
      writeImportArtifacts(
        outputDirectory,
        chunks,
        plan.counts,
        appliedAt,
        diagnostics,
        { artifactType: "tmdb_metadata", nowShowingStatus: null },
      );
      console.log(
        `Generated ${chunks.length} metadata chunks for ${plan.counts.movies} confirmed movies`,
      );
    }
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    clearGeneratedImportFiles(outputDirectory);
    writeValidationReport(outputDirectory, diagnostics);
    console.error("Metadata validation failed; inspect the private report");
    process.exitCode = 1;
  }
}
