import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildImportPlan,
  parseIntermediateJson,
  renderSqlChunks,
  type ImportDiagnostic,
} from "./import-sheet-lib";
import {
  clearGeneratedImportFiles,
  writeImportArtifacts,
  writeValidationReport,
} from "./import-files";

const [inputArgument, outputArgument, importedAt] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");

if (!inputArgument || !outputArgument || !importedAt) {
  console.error(
    "Usage: pnpm import:generate -- <intermediate.json> <output-directory> <imported-at-iso>",
  );
  process.exitCode = 2;
} else {
  const outputDirectory = resolve(outputArgument);
  const document = parseIntermediateJson(
    readFileSync(resolve(inputArgument), "utf8"),
  );
  let diagnostics: ImportDiagnostic[];

  if (!document) {
    diagnostics = [
      {
        code: "INTERMEDIATE_SCHEMA_INVALID",
        row: null,
        severity: "error",
      },
    ];
  } else {
    const plan = await buildImportPlan(document, importedAt);
    diagnostics = plan.diagnostics;
    if (!diagnostics.some((item) => item.severity === "error")) {
      const chunks = renderSqlChunks(plan.statements);
      writeImportArtifacts(
        outputDirectory,
        chunks,
        plan.counts,
        importedAt,
        diagnostics,
      );
      console.log(
        `Generated ${chunks.length} chunks for ${plan.counts.movies} movies and ${plan.counts.sources} source rows`,
      );
    }
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    clearGeneratedImportFiles(outputDirectory);
    writeValidationReport(outputDirectory, diagnostics);
    console.error("Import validation failed; inspect the private report");
    process.exitCode = 1;
  }
}
