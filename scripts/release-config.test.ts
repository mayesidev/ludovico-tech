import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { describe, expect, it, vi } from "vitest";

type ReleaseRule = {
  breaking?: boolean;
  release: "major" | "minor" | "patch" | false;
  type?: string;
};
type AnalyzerOptions = {
  preset: string;
  releaseRules: ReleaseRule[];
};
type ReleaseConfig = {
  plugins: Array<string | [string, AnalyzerOptions | { preset: string }]>;
};

const releaseModule = (await import(
  new URL("../release.config.mjs", import.meta.url).href
)) as {
  default: ReleaseConfig;
  releasePreset: string;
  releaseRules: ReleaseRule[];
};
const releaseConfig = releaseModule.default;
const { releasePreset, releaseRules } = releaseModule;
const analyzer = releaseConfig.plugins[0] as [string, AnalyzerOptions];

const releaseFor = (message: string) =>
  analyzeCommits(analyzer[1], {
    commits: [{ message }],
    logger: { log: vi.fn() },
  });

describe("semantic release configuration", () => {
  it("uses the Conventional Commits parser for analysis and notes", () => {
    expect(releasePreset).toBe("conventionalcommits");
    expect(analyzer).toEqual([
      "@semantic-release/commit-analyzer",
      { preset: releasePreset, releaseRules },
    ]);
    expect(releaseConfig.plugins[1]).toEqual([
      "@semantic-release/release-notes-generator",
      { preset: releasePreset },
    ]);
  });

  it.each([
    ["refactor(api)!: remove an endpoint", "major"],
    [
      "refactor(api): remove an endpoint\n\nBREAKING CHANGE: the endpoint is no longer available",
      "major",
    ],
    ["docs!: remove a supported contract", "major"],
    ["refactor: reorganize runtime code", "patch"],
    ["docs: clarify deployment behavior", null],
  ])("analyzes %j as %s", async (message, expected) => {
    await expect(releaseFor(message)).resolves.toBe(expected);
  });
});
