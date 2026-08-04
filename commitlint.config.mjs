export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => message.startsWith("Merge ")],
  rules: {
    // GitHub-generated squash bodies can exceed the conventional 100-character limit.
    "body-max-line-length": [0, "always"],
  },
};
