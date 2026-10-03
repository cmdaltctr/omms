import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "out/**",
      "web/dist/**",
      "web/node_modules/**",
      // Claude Code writes type files here when it loads this repo with --plugin-dir
      ".claude-plugin/types/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.bun,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  }
);
