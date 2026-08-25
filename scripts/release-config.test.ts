import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";
import { describe, expect, it, vi } from "vitest";

type ReleaseRule = {
  breaking?: boolean;
  release: "major" | "minor" | "patch" | false;
  type?: string;
};
type AnalyzerOptions = {
  config: string;
  releaseRules: ReleaseRule[];
};
type NotesOptions = {
  config: string;
};
type ReleaseConfig = {
  plugins: Array<string | [string, AnalyzerOptions | NotesOptions]>;
};

const releaseModule = (await import(
  new URL("../release.config.mjs", import.meta.url).href
)) as {
  default: ReleaseConfig;
  releasePresetConfig: string;
  releaseRules: ReleaseRule[];
};
const releaseConfig = releaseModule.default;
const { releasePresetConfig, releaseRules } = releaseModule;
const analyzer = releaseConfig.plugins[0] as [string, AnalyzerOptions];
const notesGenerator = releaseConfig.plugins[1] as [string, NotesOptions];

const releaseFor = (message: string) =>
  analyzeCommits(analyzer[1], {
    commits: [{ message }],
    cwd: process.cwd(),
    logger: { log: vi.fn() },
  });

const notesFor = (message: string) =>
  generateNotes(notesGenerator[1], {
    commits: [{ hash: "1111111111111111111111111111111111111111", message }],
    cwd: process.cwd(),
    lastRelease: {
      gitHead: "0000000000000000000000000000000000000000",
      gitTag: "v1.0.0",
    },
    nextRelease: {
      gitHead: "1111111111111111111111111111111111111111",
      gitTag: "v1.0.1",
      version: "1.0.1",
    },
    options: {
      repositoryUrl: "https://github.com/mayesidev/ludovico-tech.git",
    },
  });

describe("semantic release configuration", () => {
  it("uses the Conventional Commits parser for analysis and notes", () => {
    expect(analyzer).toEqual([
      "@semantic-release/commit-analyzer",
      { config: releasePresetConfig, releaseRules },
    ]);
    expect(releaseConfig.plugins[1]).toEqual([
      "@semantic-release/release-notes-generator",
      { config: releasePresetConfig },
    ]);
  });

  it("renders release notes with the configured preset and writer", async () => {
    const notes = await notesFor("fix(release): validate release notes");

    expect(notes).toContain("### Bug Fixes");
    expect(notes).toContain("validate release notes");
  });

  it.each([
    ["perf(api)!: retire a supported endpoint", "major"],
    [
      "fix(api): enforce request validation\n\nBREAKING CHANGE: legacy request input is no longer accepted",
      "major",
    ],
    ["refactor: reorganize runtime code", "patch"],
    ["docs: clarify deployment behavior", null],
  ])("analyzes %j as %s", async (message, expected) => {
    await expect(releaseFor(message)).resolves.toBe(expected);
  });
});
