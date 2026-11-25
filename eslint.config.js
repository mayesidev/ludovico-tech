import js from "@eslint/js";
import { plugin as shadcn } from "@shadcn/lint";
import reactDoctor from "eslint-plugin-react-doctor";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      ".e2e-state/**",
      ".react-router/**",
      ".wrangler/**",
      "blob-report/**",
      "build/**",
      "coverage/**",
      "data/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    ...reactDoctor.configs.recommended,
    files: ["src/client/**/*.{ts,tsx}"],
    settings: {
      "react-doctor": {
        ...reactDoctor.configs.recommended.settings["react-doctor"],
        capabilities: [
          "client-only",
          "pre-es2023",
          "react",
          "react:17",
          "react:18",
          "react:19",
          "react:19.2",
          "react-compiler",
          "tailwind",
          "tailwind:3.4",
          "tailwind:4",
          "tanstack-table",
          "typescript",
          "vite",
          "zod",
          "zod:4",
        ],
      },
    },
  },
  {
    files: ["src/client/components/dialog.tsx"],
    rules: { "react-doctor/prefer-html-dialog": "off" },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { shadcn },
    settings: {
      shadcn: { componentImports: ["^\\./(?:components/)?ui$"] },
    },
    rules: {
      "shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
      "shadcn/no-inline-styles": "error",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
    },
  },
);
