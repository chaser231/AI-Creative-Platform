import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Type safety
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "warn",

      // Console discipline
      "no-console": ["warn", { allow: ["error"] }],

      // React
      "react/no-unescaped-entities": "warn",

      // Quality
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["warn", "always", { null: "ignore" }],
    },
  },

  // Server files: console.error is fine for logging
  {
    files: ["src/server/**/*.ts", "src/app/api/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
