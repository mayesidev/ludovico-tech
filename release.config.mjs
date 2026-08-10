export const releaseRules = [{ type: "refactor", release: "patch" }];

export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { releaseRules }],
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
  ],
};
