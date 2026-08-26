import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCatalogImportPlan, parseCatalogCsv } from "./catalog-import-lib";
import {
  executeCatalogImport,
  importPreflightSummary,
  ImportOperatorError,
  parseImportOperatorArguments,
  type CommandRunner,
} from "./import-operator-lib";

const runCommand: CommandRunner = (executable, arguments_) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      executable,
      arguments_,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) rejectPromise(new Error("Command failed"));
        else resolvePromise(stdout);
      },
    );
  });

const usage =
  "Usage: pnpm import:catalog -- --environment <configured-environment> --database <exact-name> --csv <catalog.csv> [--persist-to <directory>] [--execute]";

const readCsv = (path: string) => {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch {
    throw new ImportOperatorError("Catalog CSV is unavailable");
  }
};

const main = async () => {
  const options = parseImportOperatorArguments(process.argv.slice(2));
  const parsed = parseCatalogCsv(readCsv(options.csvPath));
  if (parsed.diagnostics.length > 0) {
    const diagnostics = parsed.diagnostics
      .map(({ code, row }) => `${code}${row === null ? "" : ` (row ${row})`}`)
      .join(", ");
    throw new ImportOperatorError(`CSV validation failed: ${diagnostics}`);
  }
  const plan = buildCatalogImportPlan(
    parsed.movies,
    parsed.nowShowingTitle,
    new Date().toISOString(),
  );
  console.log(importPreflightSummary(plan));
  if (!options.execute) {
    console.log("No database was contacted; add --execute after review");
    return;
  }
  await executeCatalogImport(plan, options, runCommand, (message) =>
    console.log(message),
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof ImportOperatorError ? error.message : usage);
  process.exitCode = error instanceof ImportOperatorError ? 1 : 2;
});
