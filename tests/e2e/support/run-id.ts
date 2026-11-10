import path from "node:path";

/** Where serve-api records the APP_VERSION of the throwaway API it started on `port`. */
export const runIdFile = (repoRoot: string, port: string) =>
  path.join(repoRoot, ".data", `e2e-${port}`, "run-id");
