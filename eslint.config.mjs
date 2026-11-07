import { globalIgnores } from "eslint/config";

import { baseConfig } from "./packages/tooling/eslint.base.mjs";

export default baseConfig(
  {
    // Provider independence: app, features and components may depend on
    // infrastructure *interfaces* only. Concrete providers are wired in one
    // composition root inside src/infrastructure.
    files: ["src/app/**", "src/features/**", "src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/infrastructure/*/providers", "@/infrastructure/*/providers/**"],
              message:
                "Import infrastructure interfaces, not concrete providers. Providers are selected in src/infrastructure.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    "apps/**",
    "packages/**",
    ".worktrees/**",
    ".claude/**",
    ".superpowers/**",
    ".data/**",
  ]),
);
