import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseImportCorrectionsJson,
  sanitizeSourceCsv,
  type ImportCorrections,
} from "./import-sheet-lib";

const [inputArgument, outputArgument, reportArgument, correctionsArgument] =
  process.argv.slice(2).filter((argument) => argument !== "--");

if (!inputArgument || !outputArgument || !reportArgument) {
  console.error(
    "Usage: pnpm import:sanitize -- <private-source.csv> <intermediate.json> <validation-report.json> [import-corrections.json]",
  );
  process.exitCode = 2;
} else {
  const corrections: ImportCorrections | null = correctionsArgument
    ? parseImportCorrectionsJson(
        readFileSync(resolve(correctionsArgument), "utf8"),
      )
    : {
        excludedSourceRows: new Set(),
        legacyImdbIds: new Map(),
        nowShowingSourceRow: null,
        ratings: new Map(),
      };
  if (!corrections) {
    console.error("Import corrections file is invalid");
    process.exitCode = 2;
    process.exit();
  }
  const result = sanitizeSourceCsv(
    readFileSync(resolve(inputArgument), "utf8"),
    corrections,
  );
  writeFileSync(
    resolve(outputArgument),
    `${JSON.stringify(result.document, null, 2)}\n`,
  );
  writeFileSync(
    resolve(reportArgument),
    `${JSON.stringify(
      {
        diagnostics: result.diagnostics,
        schemaVersion: result.document.schemaVersion,
        valid: result.document.validated,
      },
      null,
      2,
    )}\n`,
  );

  const errors = result.diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const warnings = result.diagnostics.length - errors;
  console.log(
    `Sanitized ${result.document.rows.length} rows with ${errors} errors and ${warnings} warnings`,
  );
  if (errors > 0) process.exitCode = 1;
}
