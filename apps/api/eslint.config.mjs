import { baseConfig } from "../../packages/tooling/eslint.base.mjs";

// The API is the composition root (spec §4, rule 2): it may import every package.
export default baseConfig();
