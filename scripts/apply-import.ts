import { execFile } from "node:child_process";
import {
  executeImportBundle,
  importPreflightSummary,
  ImportOperatorError,
  loadImportBundle,
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
  "Usage: pnpm import:apply -- --environment <configured-environment> --database <exact-name> --catalog <directory> [--persist-to <directory>] [--execute]";

const main = async () => {
  const options = parseImportOperatorArguments(process.argv.slice(2));
  const bundle = loadImportBundle(options.catalogDirectory);
  console.log(importPreflightSummary(bundle));
  if (!options.execute) {
    console.log("No database was contacted; add --execute after review");
    return;
  }
  await executeImportBundle(bundle, options, runCommand, (message) =>
    console.log(message),
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof ImportOperatorError ? error.message : usage);
  process.exitCode = error instanceof ImportOperatorError ? 1 : 2;
});
