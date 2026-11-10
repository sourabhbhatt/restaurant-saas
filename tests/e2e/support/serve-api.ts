/**
 * Playwright's first web server: builds the four apps, recreates a throwaway
 * PGlite database with the demo seed, then serves the API (production build).
 *
 * The API runs a production build with a test runtime configuration:
 * NODE_ENV=test (fast password hashing, no production env checks) and
 * ENABLE_TEST_HOOKS=true (the dev mailbox the invitation journey reads).
 * Its environment is exactly the one below: ROS_NO_ENV_FILE=1 stops
 * apps/api/next.config.ts from loading the repo-root .env.local, and every
 * server setting is pinned, so a developer's local providers (analytics, push,
 * email, storage, payments, a Postgres URL) never reach an E2E run.
 *
 * APP_VERSION is a per-run id, also written to .data/e2e-<port>/run-id: global
 * setup refuses to write unless every app's /api/v1/health reports it.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runIdFile } from "./run-id";

const root = path.resolve(import.meta.dirname, "../../..");
const port = process.env.E2E_API_PORT ?? "4100";
const dataDir = path.join(root, ".data", `e2e-${port}`);
const appUrl = process.env.APP_URL ?? "http://localhost:3100";
const runId = `e2e-${randomBytes(6).toString("hex")}`;

/** Server settings that must come from here, never from the caller's shell. */
const SERVER_KEYS = [
  /^DATABASE_/,
  /^PGLITE_/,
  /^STORAGE_/,
  /^GCS_/,
  /^S3_/,
  /^EMAIL_/,
  /^RESEND_/,
  /^BREVO_/,
  /^PUSH_/,
  /^VAPID_/,
  /^PAYMENT_/,
  /^RAZORPAY_/,
  /^TRACKING_/,
  /^GA_/,
  /^ERROR_REPORTER$/,
  /^SESSION_TTL_DAYS$/,
  /^COOKIE_SECURE$/,
  /^QR_BASE_URL$/,
  /^CRON_SECRET$/,
];
const shell = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !SERVER_KEYS.some((re) => re.test(key))),
);

const env: NodeJS.ProcessEnv = {
  ...shell,
  ROS_NO_ENV_FILE: "1",
  NODE_ENV: "test",
  ENABLE_TEST_HOOKS: "true",
  APP_VERSION: runId,
  APP_URL: appUrl,
  QR_BASE_URL: appUrl,
  DATABASE_PROVIDER: "pglite",
  PGLITE_DATA_DIR: path.join(dataDir, "pglite"),
  STORAGE_PROVIDER: "local",
  STORAGE_LOCAL_DIR: path.join(dataDir, "uploads"),
  EMAIL_PROVIDER: "outbox",
  REALTIME_PROVIDER: "memory",
  PUSH_PROVIDER: "none",
  PAYMENT_PROVIDER: "none",
  TRACKING_PROVIDER: "none",
  COOKIE_SECURE: "false",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  // Per-run value: QR tokens are encrypted with it by the seed and the server alike.
  APP_SECRET: process.env.E2E_APP_SECRET ?? randomBytes(32).toString("hex"),
};

function run(cmd: string, args: string[], runEnv: NodeJS.ProcessEnv = env) {
  const res = spawnSync(cmd, args, { cwd: root, env: runEnv, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!process.env.E2E_SKIP_BUILD) {
  // Production builds: no NODE_ENV=test, and no .env.local either.
  const { NODE_ENV: _ignored, ...buildEnv } = shell;
  void _ignored;
  run(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@ros/api",
      "--filter=@ros/console",
      "--filter=@ros/ops",
      "--filter=@ros/admin",
    ],
    { ...buildEnv, ROS_NO_ENV_FILE: "1" },
  );
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
writeFileSync(runIdFile(root, port), runId);
run("pnpm", ["exec", "tsx", "--conditions=react-server", "apps/api/scripts/seed.ts"]);

const server = spawn("pnpm", ["--filter", "@ros/api", "exec", "next", "start", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
