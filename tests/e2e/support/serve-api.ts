/**
 * Playwright's first web server: builds the four apps, recreates a throwaway
 * PGlite database with the demo seed, then serves the API (production build).
 *
 * The API runs with NODE_ENV=test so ENABLE_TEST_HOOKS (test clock, dev
 * mailbox) is allowed; the frontends run as plain production servers.
 * Nothing here touches .env.local, the dev database or a Postgres server.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const port = process.env.E2E_API_PORT ?? "4100";
const dataDir = path.join(root, ".data", `e2e-${port}`);

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  ENABLE_TEST_HOOKS: "true",
  DATABASE_PROVIDER: "pglite",
  PGLITE_DATA_DIR: path.join(dataDir, "pglite"),
  STORAGE_PROVIDER: "local",
  STORAGE_LOCAL_DIR: path.join(dataDir, "uploads"),
  EMAIL_PROVIDER: "outbox",
  REALTIME_PROVIDER: "memory",
  PAYMENT_PROVIDER: "none",
  // Per-run value: QR tokens are encrypted with it by the seed and the server alike.
  APP_SECRET: process.env.E2E_APP_SECRET ?? randomBytes(32).toString("hex"),
};

function run(cmd: string, args: string[], runEnv: NodeJS.ProcessEnv = env) {
  const res = spawnSync(cmd, args, { cwd: root, env: runEnv, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!process.env.E2E_SKIP_BUILD) {
  // Production builds: the build must not inherit NODE_ENV=test.
  const { NODE_ENV: _ignored, ...buildEnv } = process.env;
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
    buildEnv,
  );
}

rmSync(dataDir, { recursive: true, force: true });
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
