import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeImportArtifacts } from "./import-files";

describe("generated import files", () => {
  it("removes only stale scoped artifacts", () => {
    const directory = mkdtempSync(join(tmpdir(), "ludovico-import-"));
    writeFileSync(join(directory, "chunk-0009.sql"), "stale");
    writeFileSync(join(directory, "manifest.json"), "stale");
    writeFileSync(join(directory, "operator-notes.txt"), "keep");

    writeImportArtifacts(
      directory,
      [{ filename: "chunk-0001.sql", sql: "SELECT 1;\n" }],
      { collections: 0, movies: 1, ratings: 0, sources: 1 },
      "2026-08-06T20:00:00.000Z",
      [],
    );

    expect(readdirSync(directory).sort()).toEqual([
      "chunk-0001.sql",
      "manifest.json",
      "operator-notes.txt",
      "validation-report.json",
    ]);
    expect(readFileSync(join(directory, "operator-notes.txt"), "utf8")).toBe(
      "keep",
    );
  });
});
