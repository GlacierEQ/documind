import eslintPluginTs from "@typescript-eslint/eslint-plugin";
import parserTs from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    ignores: ["node_modules/**"],
    languageOptions: {
      parser: parserTs,
      parserOptions: { sourceType: "module", ecmaVersion: 2021 },
    },
    plugins: { "@typescript-eslint": eslintPluginTs },
    rules: {
      "no-unused-vars": "warn",
    },
  },
];
