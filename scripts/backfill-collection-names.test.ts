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

  it("captures private SQL and output, verifies migrations, and removes temporary files", async () => {
    const database = new DatabaseSync(":memory:");
    const files = new Set<string>();
    try {
      for (const name of migrations())
        database.exec(readFileSync(`migrations/${name}`, "utf8"));
      database.exec(`INSERT INTO collections (id, name, name_key, created_at, updated_at)
        VALUES ('private-id', '東宝', '', '2026-08-01', '2026-08-01');`);
      const runner = vi.fn(async (_executable: string, args: string[]) => {
        expect(args).toContain("--local");
        expect(args).not.toContain("--remote");
        expect(args.join(" ")).not.toContain("private-id");
        expect(args.join(" ")).not.toContain("東宝");
        const command = args[args.indexOf("--command") + 1];
        let results: unknown[];
        if (args.includes("--file")) {
          const path = args[args.indexOf("--file") + 1];
          files.add(path);
          expect(statSync(path).mode & 0o777).toBe(0o600);
          database.exec(readFileSync(path, "utf8"));
          results = [];
        } else if (command.includes("d1_migrations"))
          results = migrations().map((name) => ({ name }));
        else results = database.prepare(command).all();
        return JSON.stringify([{ success: true, results }]);
      });
      expect(await runCollectionNameBackfill(options(), runner)).toEqual({
        alreadyComplete: false,
        updated: 1,
      });
      expect(
        database.prepare("SELECT name_key FROM collections").get(),
      ).toEqual({ name_key: "東宝" });
      expect(files.size).toBe(1);
      for (const path of files) expect(existsSync(path)).toBe(false);
    } finally {
      database.close();
    }
  });

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
