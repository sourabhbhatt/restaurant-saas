import { FRONTEND_BOUNDARY, baseConfig } from "../tooling/eslint.base.mjs";

// Shared client plumbing follows the frontend rule (spec §4, rule 1).
export default baseConfig(FRONTEND_BOUNDARY);
