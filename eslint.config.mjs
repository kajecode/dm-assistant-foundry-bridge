// @ts-check
import js          from "@eslint/js";
import tseslint    from "typescript-eslint";
import prettier    from "eslint-config-prettier";
import globals     from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Foundry globals — present at runtime, declared so eslint doesn't flag them.
        game:           "readonly",
        canvas:         "readonly",
        Hooks:          "readonly",
        CONFIG:         "readonly",
        ui:             "readonly",
        foundry:        "readonly",
        FilePicker:     "readonly",
        Actor:          "readonly",
        JournalEntry:   "readonly",
        Folder:         "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console":                                 "off",
    },
  },
);
