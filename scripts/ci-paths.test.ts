import { describe, expect, it } from "vitest";
import { classifyCiPaths } from "./ci-paths";

describe("CI path classification", () => {
  it("uses lightweight verification for Markdown-only changes", () => {
    expect(
      classifyCiPaths([
        "README.md",
        "docs/private-import.md",
        ".github/pull_request_template.md",
      ]),
    ).toEqual({ full: false, renovateConfig: false });
  });

  it("validates Renovate config without running application checks", () => {
    expect(classifyCiPaths(["renovate.json"])).toEqual({
      full: false,
      renovateConfig: true,
    });
    expect(classifyCiPaths(["renovate.json", "CONTRIBUTING.md"])).toEqual({
      full: false,
      renovateConfig: true,
    });
  });

  it("still validates Renovate config when another path requires full CI", () => {
    expect(classifyCiPaths(["renovate.json", "src/worker/index.ts"])).toEqual({
      full: true,
      renovateConfig: true,
    });
  });

  it.each([
    ["application source", ["src/client/App.tsx"]],
    ["dependencies", ["pnpm-lock.yaml"]],
    ["workflow configuration", [".github/workflows/ci.yml"]],
    ["non-documentation artifacts", ["docs/catalog-import-template.csv"]],
    ["mixed application and docs", ["README.md", "src/worker/index.ts"]],
    ["an empty or indeterminate diff", []],
  ])("uses full verification for %s", (_description, paths) => {
    expect(classifyCiPaths(paths)).toEqual({
      full: true,
      renovateConfig: false,
    });
  });
});
