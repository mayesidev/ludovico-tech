import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface CiPathScope {
  full: boolean;
  renovateConfig: boolean;
}

const normalizePath = (path: string) =>
  path.replaceAll("\\", "/").replace(/^\.\/+/, "");

const isDocumentation = (path: string) => path.endsWith(".md");

export const classifyCiPaths = (paths: readonly string[]): CiPathScope => {
  const normalizedPaths = paths.map(normalizePath).filter(Boolean);
  const renovateConfig = normalizedPaths.includes("renovate.json");
  const onlyLightweightPaths =
    normalizedPaths.length > 0 &&
    normalizedPaths.every(
      (path) => isDocumentation(path) || path === "renovate.json",
    );

  return {
    full: !onlyLightweightPaths,
    renovateConfig,
  };
};

const changedPaths = (baseSha: string, headSha: string): string[] => {
  const args = /^0+$/.test(baseSha)
    ? [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-only",
        "-r",
        "-z",
        headSha,
      ]
    : [
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        baseSha,
        headSha,
      ];
  const output = execFileSync("git", args);

  return output.toString().split("\0").filter(Boolean);
};

const requiredEnvironmentValue = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const run = () => {
  const paths = changedPaths(
    requiredEnvironmentValue("BASE_SHA"),
    requiredEnvironmentValue("HEAD_SHA"),
  );
  const scope = classifyCiPaths(paths);
  const outputPath = requiredEnvironmentValue("GITHUB_OUTPUT");

  appendFileSync(
    outputPath,
    `full=${scope.full}\nrenovate_config=${scope.renovateConfig}\n`,
  );
  console.log(
    `CI scope: ${scope.full ? "full" : "lightweight"} (${JSON.stringify(paths)})`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run();
}
