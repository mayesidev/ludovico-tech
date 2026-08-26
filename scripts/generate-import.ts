import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCatalogImportPlan,
  parseCatalogCsv,
  renderSqlChunks,
} from "./catalog-import-lib";
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
    "Usage: pnpm import:generate -- <catalog.csv> <output-directory> <imported-at-iso>",
  );
  process.exitCode = 2;
} else {
  const outputDirectory = resolve(outputArgument);
  const parsed = parseCatalogCsv(readFileSync(resolve(inputArgument), "utf8"));
  const plan = parsed.diagnostics.length
    ? null
    : await buildCatalogImportPlan(parsed.seed, importedAt);
  const diagnostics = [...parsed.diagnostics, ...(plan?.diagnostics ?? [])];

  if (diagnostics.length === 0 && plan) {
    const chunks = renderSqlChunks(plan.statements);
    writeImportArtifacts(
      outputDirectory,
      chunks,
      plan.counts,
      importedAt,
      diagnostics,
    );
    console.log(
      `Generated ${chunks.length} chunks for ${plan.counts.movies} movies`,
    );
  } else {
    clearGeneratedImportFiles(outputDirectory);
    writeValidationReport(outputDirectory, diagnostics);
    console.error("Import validation failed; inspect the private report");
    process.exitCode = 1;
  }
}
