import { describe, expect, it } from "vitest";

type ReleaseRule = { type: string; release: string };
type ReleaseConfig = {
  plugins: Array<string | [string, { releaseRules: ReleaseRule[] }]>;
};

const releaseModule = (await import(
  new URL("../release.config.mjs", import.meta.url).href
)) as {
  default: ReleaseConfig;
  releaseRules: ReleaseRule[];
};
const releaseConfig = releaseModule.default;
const { releaseRules } = releaseModule;

describe("semantic release configuration", () => {
  it("publishes runtime refactors as patch releases", () => {
    expect(releaseRules).toEqual([{ type: "refactor", release: "patch" }]);
    expect(releaseConfig.plugins[0]).toEqual([
      "@semantic-release/commit-analyzer",
      { releaseRules },
    ]);
  });

  it("leaves documentation commits non-releasing", () => {
    expect(releaseRules).not.toContainEqual(
      expect.objectContaining({ type: "docs" }),
    );
  });
});
