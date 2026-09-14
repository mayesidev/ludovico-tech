import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  backfillCollectionNames,
  CollectionNameBackfillError,
} from "./collection-name-backfill";
import { assertReleaseMigrationsApplied } from "./release-gates";
import { parseWranglerConfig } from "./validate-cloudflare-config-lib";

const usage =
  "Usage: pnpm backfill:collection-names -- --environment <configured-environment> --database <exact-name> [--persist-to <local-directory>] --execute";
// Reads contain at most 1,000 rows, including names that expand during NFKD.
export const COLLECTION_BACKFILL_MAX_BUFFER = 32 * 1024 * 1024;
type Options = {
  environment: string;
  database: string;
  persistTo: string | null;
};
type CommandRunner = (
  executable: string,
  arguments_: string[],
) => Promise<string>;

const validateTarget = (options: Options) => {
  const config = parseWranglerConfig(readFileSync("wrangler.jsonc", "utf8"));
  const bindings = config.env?.[options.environment]?.d1_databases;
  if (
    bindings?.length !== 1 ||
    bindings[0].binding !== "DB" ||
    bindings[0].database_name !== options.database ||
    (options.environment === "development"
      ? !options.persistTo
      : options.persistTo !== null)
  )
    throw new CollectionNameBackfillError(
      "Collection name backfill target is invalid",
    );
};

export const parseCollectionBackfillArguments = (
  arguments_: string[],
): Options => {
  try {
    const { values, tokens } = parseArgs({
      args: arguments_.filter((value) => value !== "--"),
      tokens: true,
      options: {
        environment: { type: "string" },
        database: { type: "string" },
        "persist-to": { type: "string" },
        execute: { type: "boolean" },
      },
    });
    const environment = values.environment;
    const database = values.database;
    const persistTo = values["persist-to"] ?? null;
    const names = tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (
      !values.execute ||
      !environment ||
      !database ||
      new Set(names).size !== names.length
    )
      throw new Error();
    const options = { environment, database, persistTo };
    validateTarget(options);
    return options;
  } catch {
    throw new CollectionNameBackfillError(usage);
  }
};

const responseSchema = z
  .array(
    z.object({
      success: z.literal(true),
      results: z.array(z.record(z.string(), z.unknown())),
    }),
  )
  .nonempty();

export const runCollectionNameBackfill = async (
  options: Options,
  runner: CommandRunner,
) => {
  validateTarget(options);
  const directory = mkdtempSync(join(tmpdir(), "ludovico-collection-names-"));
  const path = join(directory, "backfill.sql");
  const run = async (arguments_: string[]) => {
    try {
      const output = await runner("pnpm", [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--config",
        "wrangler.jsonc",
        "--env",
        options.environment,
        options.environment === "development" ? "--local" : "--remote",
        ...(options.persistTo
          ? ["--persist-to", resolve(options.persistTo)]
          : []),
        "--experimental-auto-create=false",
        "--experimental-provision=false",
        "--yes",
        "--json",
        ...arguments_,
      ]);
      return responseSchema.parse(JSON.parse(output));
    } catch {
      throw new CollectionNameBackfillError(
        "Collection name backfill command failed; keep maintenance enabled",
      );
    }
  };
  const query = async (sql: string) => {
    const response = await run(["--command", sql]);
    if (response.length !== 1)
      throw new CollectionNameBackfillError(
        "Collection name backfill query returned invalid data",
      );
    return response[0].results;
  };
  try {
    const migrations = await run([
      "--command",
      "SELECT name FROM d1_migrations ORDER BY id",
    ]);
    try {
      assertReleaseMigrationsApplied(
        readdirSync("migrations")
          .filter((name) => /^\d+.*\.sql$/.test(name))
          .sort(),
        migrations,
      );
    } catch {
      throw new CollectionNameBackfillError(
        "Collection name backfill requires the exact release migrations",
      );
    }
    return await backfillCollectionNames({
      query,
      execute: async (sql) => {
        writeFileSync(path, sql, { mode: 0o600 });
        await run(["--file", path]);
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runCommand: CommandRunner = (executable, arguments_) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      executable,
      arguments_,
      { encoding: "utf8", maxBuffer: COLLECTION_BACKFILL_MAX_BUFFER },
      (error, stdout) => {
        if (error) rejectPromise(new Error("Command failed"));
        else resolvePromise(stdout);
      },
    );
  });

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const main = async () => {
    const result = await runCollectionNameBackfill(
      parseCollectionBackfillArguments(process.argv.slice(2)),
      runCommand,
    );
    console.log(
      result.alreadyComplete
        ? "Collection name backfill was already verified"
        : `Verified collection name backfill (${result.updated} updated)`,
    );
  };
  main().catch((error: unknown) => {
    console.error(
      error instanceof CollectionNameBackfillError
        ? error.message
        : "Collection name backfill failed; keep maintenance enabled",
    );
    process.exitCode = 1;
  });
}
