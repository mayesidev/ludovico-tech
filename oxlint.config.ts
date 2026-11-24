import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig } from "oxlint";

// Oxlint reserves the native React plugin names. Run the upstream presets under aliases.
const upstreamRules = Object.fromEntries(
  Object.entries({
    ...reactHooks.configs.flat["recommended-latest"].rules,
    ...reactRefresh.configs.vite.rules,
  }).map(([rule, setting]) => [rule.replace("/", "-upstream/"), setting]),
);

export default defineConfig({
  categories: { correctness: "error" },
  jsPlugins: [
    { name: "react-hooks-upstream", specifier: "eslint-plugin-react-hooks" },
    {
      name: "react-refresh-upstream",
      specifier: "eslint-plugin-react-refresh",
    },
  ],
  rules: upstreamRules,
});
