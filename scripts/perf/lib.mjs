/** Shared helpers for the perf harness: env, processes, waiting, statistics. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PORTS = {
  api: Number(process.env.PERF_API_PORT ?? 4150),
  console: Number(process.env.PERF_CONSOLE_PORT ?? 3150),
  ops: Number(process.env.PERF_OPS_PORT ?? 3151),
  admin: Number(process.env.PERF_ADMIN_PORT ?? 3152),
  pg: Number(process.env.PERF_PG_PORT ?? 55150),
};

export const ORIGINS = {
  console: `http://localhost:${PORTS.console}`,
  ops: `http://localhost:${PORTS.ops}`,
  admin: `http://localhost:${PORTS.admin}`,
  api: `http://localhost:${PORTS.api}`,
};

/** Minimal .env parser (KEY=VALUE, # comments); values are never logged. */
export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** API environment: .env.local plus the perf database and our ports (later keys win). */
export function apiEnv(db) {
  const base = readEnvFile(path.join(ROOT, ".env.local"));
  return {
    ...base,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    APP_URL: ORIGINS.console,
    ALLOWED_ORIGINS: [ORIGINS.console, ORIGINS.ops, ORIGINS.admin].join(","),
    CONSOLE_URL: ORIGINS.console,
    OPS_URL: ORIGINS.ops,
    ADMIN_URL: ORIGINS.admin,
    TRUSTED_PROXY_HOPS: "1",
    ENABLE_TEST_HOOKS: "false",
    PAYMENT_PROVIDER: "none",
    REALTIME_PROVIDER: "memory",
    LOG_LEVEL: "warn",
    ...db,
  };
}

export function frontendEnv() {
  return {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    API_INTERNAL_URL: ORIGINS.api,
    CONSOLE_URL: ORIGINS.console,
    OPS_URL: ORIGINS.ops,
    ADMIN_URL: ORIGINS.admin,
  };
}

export function log(...args) {
  console.log(`[perf ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

/** Run a command to completion; throws on a non-zero exit. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0 && !opts.allowFail) {
    const tail = opts.capture ? `\n${(res.stderr || res.stdout || "").slice(-2000)}` : "";
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}${tail}`);
  }
  return res;
}

const children = new Set();

/** Start a long-running process in its own process group. */
export function start(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.output = "";
  const keep = (d) => {
    child.output = (child.output + d.toString()).slice(-20000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.perfName = name;
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

export async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 5000);
  await exited;
  clearTimeout(timer);
}

export async function stopAll() {
  await Promise.all([...children].map(stop));
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopAll().finally(() => process.exit(130));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `url` until it answers with `status` (default any 2xx). Returns elapsed ms. */
export async function waitFor(url, { timeoutMs = 120_000, intervalMs = 25, child, ok } = {}) {
  const t0 = performance.now();
  for (;;) {
    if (child && child.exitCode !== null)
      throw new Error(`${child.perfName} exited early:\n${child.output.slice(-3000)}`);
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      await res.arrayBuffer();
      if (ok ? ok(res.status) : res.status >= 200 && res.status < 300)
        return performance.now() - t0;
    } catch {
      // not up yet
    }
    if (performance.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${url}`);
    await sleep(intervalMs);
  }
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export const round = (n, d = 1) =>
  n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d;

/** Directory size in bytes (du -sk). */
export function dirBytes(dir) {
  if (!existsSync(dir)) return null;
  const res = run("du", ["-sk", dir], { capture: true });
  return Number(res.stdout.split(/\s+/)[0]) * 1024;
}
