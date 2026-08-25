export const releasePreset = "conventionalcommits";
export const releaseRules = [
  { breaking: true, release: "major" },
  { type: "refactor", release: "patch" },
];

export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      { preset: releasePreset, releaseRules },
    ],
    ["@semantic-release/release-notes-generator", { preset: releasePreset }],
    "@semantic-release/github",
  ],
};
