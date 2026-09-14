import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  COLLECTION_BACKFILL_MAX_BUFFER,
  parseCollectionBackfillArguments,
  runCollectionNameBackfill,
} from "./backfill-collection-names";
import {
  COLLECTION_NAME_BACKFILL_LIMIT,
  COLLECTION_NAME_READ_SIZE,
} from "./collection-name-backfill";
import { normalizeCollectionName } from "../src/shared/normalize-collection-name";

const migrations = () =>
  readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
const options = () =>
  parseCollectionBackfillArguments([
    "--environment",
    "development",
    "--database",
    "ludovico-tech-development",
    "--persist-to",
    "data/synthetic-backfill",
    "--execute",
  ]);
const remoteOptions = () =>
  parseCollectionBackfillArguments([
    "--environment",
    "staging",
    "--database",
    "ludovico-tech-staging",
    "--execute",
  ]);
const importOutput = `├ Checking if file needs uploading
│
├ 🌌 Uploading synthetic.sql
│ 🌌 Uploading complete.
│
${JSON.stringify([{ success: true, results: [{ "Rows written": 1 }] }])}`;
const createDatabase = () => {
  const database = new DatabaseSync(":memory:");
  for (const name of migrations())
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  database.exec(`INSERT INTO collections (id, name, name_key, created_at, updated_at)
    VALUES ('private-id', '東宝', '', '2026-08-01', '2026-08-01');`);
  return database;
};
const queryOutput = (database: DatabaseSync, args: string[]) => {
  const command = args[args.indexOf("--command") + 1];
  const results = command.includes("d1_migrations")
    ? migrations().map((name) => ({ name }))
    : database.prepare(command).all();
  return JSON.stringify([{ success: true, results }]);
};

describe("collection backfill operator boundary", () => {
  it("bounds each response for supported names with large Unicode expansions", () => {
    const name = `9999 ${"\ufdfa".repeat(195)}`;
    const key = normalizeCollectionName(name);
    expect(name).toHaveLength(200);
    expect(Buffer.byteLength(key)).toBe(6_440);
    const row = {
      id_hex: Buffer.from("00000000-0000-4000-8000-000000000000").toString(
        "hex",
      ),
      name_hex: Buffer.from(name).toString("hex"),
      key_hex: Buffer.from(key).toString("hex"),
    };
    expect(
      Buffer.byteLength(JSON.stringify(row)) * COLLECTION_NAME_BACKFILL_LIMIT,
    ).toBeGreaterThan(32 * 1024 * 1024);
    // At most 33 normalized UTF-8 bytes per input UTF-16 unit, doubled by hex.
    // Include UUID/name hex, row formatting and an additional MiB for metadata.
    const maximumRowBytes = 36 * 2 + 200 * 3 * 2 + 200 * 33 * 2 + 1024;
    expect(
      maximumRowBytes * COLLECTION_NAME_READ_SIZE + 1024 * 1024,
    ).toBeLessThan(COLLECTION_BACKFILL_MAX_BUFFER);
  });

  it("requires an explicit matching target and isolated local persistence", () => {
    expect(options()).toMatchObject({
      environment: "development",
      database: "ludovico-tech-development",
    });
    for (const args of [
      [],
      ["--environment", "production", "--database", "wrong", "--execute"],
      [
        "--environment",
        "development",
        "--database",
        "ludovico-tech-development",
        "--execute",
      ],
      [
        "--environment",
        "production",
        "--database",
        "ludovico-tech-production",
        "--persist-to",
        "data/test",
        "--execute",
      ],
      ["--environment", "production", "--database", "ludovico-tech-production"],
    ])
      expect(() => parseCollectionBackfillArguments(args)).toThrow("Usage:");
  });

  it.each(["local", "remote"])(
    "verifies %s writes privately and removes temporary files",
    async (target) => {
      const database = createDatabase();
      const files = new Set<string>();
      try {
        const runner = vi.fn(async (_executable: string, args: string[]) => {
          expect(args).toContain(`--${target}`);
          expect(args).not.toContain(
            target === "local" ? "--remote" : "--local",
          );
          expect(args.join(" ")).not.toContain("private-id");
          expect(args.join(" ")).not.toContain("東宝");
          if (args.includes("--file")) {
            const path = args[args.indexOf("--file") + 1];
            files.add(path);
            expect(statSync(path).mode & 0o777).toBe(0o600);
            database.exec(readFileSync(path, "utf8"));
            return target === "remote"
              ? importOutput
              : JSON.stringify([{ success: true, results: [] }]);
          }
          return queryOutput(database, args);
        });
        const selectedOptions =
          target === "local" ? options() : remoteOptions();
        expect(
          await runCollectionNameBackfill(selectedOptions, runner),
        ).toEqual({
          alreadyComplete: false,
          updated: 1,
        });
        expect(
          database.prepare("SELECT name_key FROM collections").get(),
        ).toEqual({ name_key: "東宝" });
        expect(
          database
            .prepare("SELECT completed FROM collection_name_backfill")
            .get(),
        ).toEqual({ completed: 1 });
        expect(files.size).toBe(1);
        for (const path of files) expect(existsSync(path)).toBe(false);
      } finally {
        database.close();
      }
    },
  );

  it.each(["keys", "marker"])(
    "rejects a failed %s write and can retry after rollback",
    async (failure) => {
      const database = createDatabase();
      const files = new Set<string>();
      let failOnce = true;
      try {
        const runner = vi.fn(async (_executable: string, args: string[]) => {
          if (!args.includes("--file")) return queryOutput(database, args);
          const path = args[args.indexOf("--file") + 1];
          files.add(path);
          const sql = readFileSync(path, "utf8");
          const phase = sql.includes("UPDATE collections") ? "keys" : "marker";
          // Simulate a failed remote import after SQL execution, with its
          // transaction rolled back before the child reports a nonzero exit.
          database.exec("BEGIN");
          try {
            database.exec(sql);
            if (failOnce && phase === failure) {
              failOnce = false;
              throw new Error("private failed command output");
            }
            database.exec("COMMIT");
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
          return importOutput;
        });
        await expect(
          runCollectionNameBackfill(remoteOptions(), runner),
        ).rejects.toThrow(
          "Collection name backfill command failed; keep maintenance enabled",
        );
        expect(
          database
            .prepare("SELECT completed FROM collection_name_backfill")
            .get(),
        ).toEqual({ completed: 0 });
        expect(
          database.prepare("SELECT name_key FROM collections").get(),
        ).toEqual({ name_key: failure === "keys" ? "" : "東宝" });
        for (const path of files) expect(existsSync(path)).toBe(false);
        expect(
          await runCollectionNameBackfill(remoteOptions(), runner),
        ).toEqual({
          alreadyComplete: false,
          updated: failure === "keys" ? 1 : 0,
        });
        expect(
          database.prepare("SELECT name_key FROM collections").get(),
        ).toEqual({ name_key: "東宝" });
        expect(
          database
            .prepare("SELECT completed FROM collection_name_backfill")
            .get(),
        ).toEqual({ completed: 1 });
        for (const path of files) expect(existsSync(path)).toBe(false);
      } finally {
        database.close();
      }
    },
  );

  it.each(["keys", "marker"])(
    "does not accept successful %s output without persisted state",
    async (skipped) => {
      const database = createDatabase();
      try {
        const runner = vi.fn(async (_executable: string, args: string[]) => {
          if (!args.includes("--file")) return queryOutput(database, args);
          const sql = readFileSync(args[args.indexOf("--file") + 1], "utf8");
          const phase = sql.includes("UPDATE collections") ? "keys" : "marker";
          if (phase !== skipped) database.exec(sql);
          return importOutput;
        });
        await expect(
          runCollectionNameBackfill(remoteOptions(), runner),
        ).rejects.toThrow(
          skipped === "keys"
            ? "verification failed"
            : "completion could not be verified",
        );
        expect(
          database
            .prepare("SELECT completed FROM collection_name_backfill")
            .get(),
        ).toEqual({ completed: 0 });
      } finally {
        database.close();
      }
    },
  );

  it.each([
    "private malformed read output",
    importOutput,
    JSON.stringify([{ success: false, results: [] }]),
    JSON.stringify([]),
  ])(
    "rejects invalid read output without executing writes (%#)",
    async (output) => {
      const runner = vi.fn().mockResolvedValue(output);
      await expect(
        runCollectionNameBackfill(remoteOptions(), runner),
      ).rejects.toThrow("Collection name backfill query returned invalid data");
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner.mock.calls[0][1]).toContain("--command");
    },
  );

  it("refuses incomplete migrations before reading or changing catalog data", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ success: true, results: [] }]));
    await expect(runCollectionNameBackfill(options(), runner)).rejects.toThrow(
      "exact release migrations",
    );
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("does not expose failed command output", async () => {
    const runner = vi
      .fn()
      .mockRejectedValue(new Error("private provider/catalog values"));
    await expect(runCollectionNameBackfill(options(), runner)).rejects.toThrow(
      "Collection name backfill command failed; keep maintenance enabled",
    );
  });
});
