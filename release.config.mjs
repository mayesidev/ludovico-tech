export const releasePresetConfig = "./scripts/release-preset.mjs";
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
      { config: releasePresetConfig, releaseRules },
    ],
    [
      "@semantic-release/release-notes-generator",
      { config: releasePresetConfig },
    ],
    "@semantic-release/github",
  ],
};
