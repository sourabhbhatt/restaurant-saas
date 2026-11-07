import { FRONTEND_BOUNDARY, baseConfig } from "../../packages/tooling/eslint.base.mjs";

// Frontends talk to the API over HTTP only (spec §4, rule 1).
export default baseConfig(FRONTEND_BOUNDARY);
