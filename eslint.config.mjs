import { globalIgnores } from "eslint/config";

import { baseConfig } from "./packages/tooling/eslint.base.mjs";

// Root-level files only (scripts, e2e, configs); apps and packages lint themselves.
export default baseConfig(
  globalIgnores([
    "apps/**",
    "packages/**",
    ".worktrees/**",
    ".claude/**",
    ".superpowers/**",
    ".data/**",
  ]),
);
