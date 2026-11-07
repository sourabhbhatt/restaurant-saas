import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import pluginQuery from "@tanstack/eslint-plugin-query";
import prettier from "eslint-config-prettier/flat";

export const IGNORES = [
  ".next/**",
  ".turbo/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
  "playwright-report/**",
  "test-results/**",
  "coverage/**",
  "node_modules/**",
];

/**
 * `no-restricted-imports` entry for a layer boundary. Type-only imports are
 * allowed: a repository may implement a port's interface without the package
 * depending on the port's package at runtime.
 */
export function restrictImports(patterns) {
  return {
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: patterns.map(({ group, message, allowTypeImports = true }) => ({
            group,
            message,
            allowTypeImports,
          })),
        },
      ],
    },
  };
}

/** ESLint flat config shared by every app and package. */
export function baseConfig(...extra) {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    ...pluginQuery.configs["flat/recommended"],
    {
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/consistent-type-imports": "error",
        // App Router only: there is no `pages/` directory anywhere in the workspace.
        "@next/next/no-html-link-for-pages": "off",
      },
    },
    ...extra,
    prettier,
    globalIgnores(IGNORES),
  ]);
}

/** Boundaries shared by the three frontends (spec §4, rule 1). */
export const FRONTEND_BOUNDARY = restrictImports([
  {
    group: [
      "@ros/application",
      "@ros/application/*",
      "@ros/adapters",
      "@ros/adapters/*",
      "@ros/database",
      "@ros/database/*",
    ],
    message:
      "Frontends talk to the API over HTTP. Import @ros/api-client, @ros/contracts or @ros/domain.",
    allowTypeImports: false,
  },
]);
