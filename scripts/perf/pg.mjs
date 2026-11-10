/**
 * Optional Postgres 18 leg (the production engine, local, free). The API
 * connects as `ros_runtime` and switches to `ros_tenant` per transaction, as
 * in production, so plans include the row-level security predicates.
 *
 * Server: a throwaway cluster on 127.0.0.1:PERF_PG_PORT with pg_stat_statements
 * and auto_explain preloaded. Preferred backend is local Postgres 18 binaries
 * (PERF_PG_BIN, or Postgres.app / Homebrew / Debian paths): `initdb` into
 * .data/perf/pg18, its own port and socket dir; no other cluster is touched.
 * Fallback: a `postgres:18` Docker container (PERF_PG_BACKEND=docker forces it).
 *
 * - Statements per request: pg_stat_statements is reset, one request is made,
 *   and the calls made by ros_runtime are summed (BEGIN/COMMIT/SET included,
 *   since each is a round trip).
 * - Plans: auto_explain (log_analyze, log_buffers, min duration 0) is switched
 *   on for one request per endpoint, then off again before load tests; the
 *   server log is split per endpoint by RAISE LOG markers.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { log, PORTS, ROOT, round, run, sleep } from "./lib.mjs";

export const CONTAINER = process.env.PERF_PG_CONTAINER ?? "ros-perf-pg";
const IMAGE = process.env.PERF_PG_IMAGE ?? "postgres:18";
const PASSWORD = "perf-local-only";
const DB = "ros_perf";
const DATA = path.join(ROOT, ".data", "perf", "pg18");

export const OWNER_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORTS.pg}/${DB}`;
export const RUNTIME_URL = `postgres://ros_runtime:${PASSWORD}@127.0.0.1:${PORTS.pg}/${DB}`;

// auto_explain.log_min_duration stays at its default (-1, off) here: a command-line value would
// override the ALTER SYSTEM toggle used for the plan pass.
const SETTINGS = [
  "shared_preload_libraries=pg_stat_statements,auto_explain",
  "auto_explain.log_analyze=on",
  "auto_explain.log_buffers=on",
  "auto_explain.log_timing=on",
  "max_connections=50",
  // Small WAL footprint for a throwaway cluster (does not change query plans).
  "max_wal_size=64MB",
  "min_wal_size=32MB",
];

function localBin() {
  const candidates = [
    process.env.PERF_PG_BIN,
    "/Applications/Postgres.app/Contents/Versions/18/bin",
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/lib/postgresql/18/bin",
  ].filter(Boolean);
  for (const dir of candidates) {
    const bin = path.join(dir, "postgres");
    if (!existsSync(bin)) continue;
    const v = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (/\b18\./.test(v.stdout)) return dir;
  }
  return null;
}

function dockerWorks() {
  const res = spawnSync("docker", ["run", "--rm", IMAGE, "true"], { encoding: "utf8" });
  return res.status === 0;
}

let backend = null;

/** "local" (binaries), "docker", or null when neither is usable. */
export function detectBackend() {
  if (process.env.PERF_PG_BACKEND !== "docker" && localBin()) return (backend = "local");
  if (process.env.PERF_PG_BACKEND !== "local" && dockerWorks()) return (backend = "docker");
  return (backend = null);
}

export function psql(query, { user = "postgres", allowFail = false } = {}) {
  const args = ["-U", user, "-d", DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", query];
  const opts = { capture: true, allowFail };
  const res =
    backend === "local"
      ? run(
          path.join(localBin(), "psql"),
          ["-h", "127.0.0.1", "-p", String(PORTS.pg), ...args],
          opts,
        )
      : run("docker", ["exec", CONTAINER, "psql", ...args], opts);
  return allowFail
    ? { ok: res.status === 0, out: `${res.stdout}${res.stderr}`.trim() }
    : res.stdout.trim();
}

export async function startPostgres() {
  if (backend === "local") {
    const bin = localBin();
    rmSync(DATA, { recursive: true, force: true });
    run(
      path.join(bin, "initdb"),
      [
        "-D",
        DATA,
        "-U",
        "postgres",
        "-A",
        "trust",
        "-E",
        "UTF8",
        "--locale=C",
        "--no-instructions",
      ],
      { capture: true },
    );
    const opts = [
      `-p ${PORTS.pg}`,
      // TCP only: a socket path under the repo can exceed the 103-byte limit.
      "-c unix_socket_directories=''",
      "-c listen_addresses=127.0.0.1",
      ...SETTINGS.map((x) => `-c ${x}`),
    ];
    // A cluster stopped moments ago can still hold the port briefly: retry a few times.
    for (let attempt = 1; ; attempt++) {
      const res = run(
        path.join(bin, "pg_ctl"),
        ["-D", DATA, "-l", path.join(DATA, "server.log"), "-o", opts.join(" "), "-w", "start"],
        { capture: true, allowFail: true },
      );
      if (res.status === 0) break;
      if (attempt >= 5) throw new Error(`pg_ctl start failed:\n${serverLog().slice(-1500)}`);
      await sleep(2000);
    }
    run(
      path.join(bin, "psql"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(PORTS.pg),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-c",
        `create database ${DB}`,
      ],
      { capture: true },
    );
    return;
  }
  run("docker", ["rm", "-f", CONTAINER], { capture: true, allowFail: true });
  run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      CONTAINER,
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-e",
      `POSTGRES_DB=${DB}`,
      "-p",
      `127.0.0.1:${PORTS.pg}:5432`,
      IMAGE,
      ...SETTINGS.flatMap((x) => ["-c", x]),
    ],
    { capture: true },
  );
  for (let i = 0; i < 120; i++) {
    const ready = () =>
      spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB]).status ===
      0;
    // The image restarts the server once after init; require two successes 1.5 s apart.
    if (ready()) {
      await sleep(1500);
      if (ready()) return;
    }
    await sleep(500);
  }
  throw new Error("Postgres container did not become ready");
}

export function stopPostgres() {
  if (backend === "local") {
    const res = run(path.join(localBin(), "pg_ctl"), ["-D", DATA, "-m", "fast", "-w", "stop"], {
      capture: true,
      allowFail: true,
    });
    if (res.status !== 0)
      run(path.join(localBin(), "pg_ctl"), ["-D", DATA, "-m", "immediate", "-w", "stop"], {
        capture: true,
        allowFail: true,
      });
    rmSync(DATA, { recursive: true, force: true });
    return;
  }
  run("docker", ["rm", "-f", CONTAINER], { capture: true, allowFail: true });
}

function serverLog() {
  if (backend === "local") return readFileSync(path.join(DATA, "server.log"), "utf8");
  const res = spawnSync("docker", ["logs", CONTAINER], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return `${res.stdout}\n${res.stderr}`;
}

/** After migrations and seeds: let ros_runtime log in, enable statement stats. */
export function preparePostgres() {
  psql(`alter role ros_runtime login password '${PASSWORD}'`);
  psql(`grant connect on database ${DB} to ros_runtime`);
  psql("create extension if not exists pg_stat_statements");
  psql("analyze");
  // Migration 0007 lets the runtime role read the journal (readiness probe); record it.
  const probe = psql("select to_regclass('drizzle.__drizzle_migrations') is not null", {
    user: "ros_runtime",
    allowFail: true,
  });
  return { runtimeCanReadMigrationJournal: probe.ok && probe.out === "t" };
}

/** Statements ros_runtime ran during `fn` (one request). */
export async function countStatements(fn) {
  psql("select pg_stat_statements_reset()");
  await fn();
  await sleep(150);
  const rows = psql(
    `select calls, regexp_replace(left(query, 120), '\\s+', ' ', 'g') from pg_stat_statements
     where userid = 'ros_runtime'::regrole and dbid = (select oid from pg_database where datname = '${DB}')
     order by calls desc`,
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return { calls: Number(l.slice(0, i)), query: l.slice(i + 1) };
    });
  const total = rows.reduce((s, r) => s + r.calls, 0);
  const isTx = (q) => /^(begin|commit|rollback|savepoint|release)/i.test(q);
  const isCtx = (q) => /^set local role|set_config\('app\./i.test(q);
  const transactions = rows.filter((r) => /^begin/i.test(r.query)).reduce((s, r) => s + r.calls, 0);
  const data = rows.filter((r) => !isTx(r.query) && !isCtx(r.query));
  return {
    statements: total,
    transactions,
    dataStatements: data.reduce((s, r) => s + r.calls, 0),
    repeated: data.filter((r) => r.calls > 2).map((r) => `${r.calls}x ${r.query}`),
  };
}

export function setAutoExplain(on) {
  psql(`alter system set auto_explain.log_min_duration = ${on ? 0 : -1}`);
  psql("select pg_reload_conf()");
}

export function markLog(name) {
  psql(`do $$ begin raise log 'PERF-MARK %', ${"$q$"}${name}${"$q$"}; end $$`);
}

const BIG =
  /\b(orders|order_items|order_status_history|bills|bill_items|payments|table_sessions|payment_history|menu_items|audit_logs)\b/;

/** Split auto_explain output by marker and summarise each endpoint's plans. */
export function collectPlans() {
  const text = serverLog();
  const sections = {};
  let current = null;
  let plan = null;
  const flush = () => {
    if (current && plan) sections[current].push(plan);
    plan = null;
  };
  for (const line of text.split("\n")) {
    const mark = /LOG:\s+PERF-MARK (\S+)\s*$/.exec(line);
    if (mark) {
      flush();
      current = mark[1].trim();
      sections[current] = [];
      continue;
    }
    if (!current) continue;
    const head = /LOG:\s+duration: ([\d.]+) ms\s+plan:/.exec(line);
    if (head) {
      flush();
      plan = { ms: Number(head[1]), text: [] };
      continue;
    }
    if (plan) {
      if (/^\d{4}-\d{2}-\d{2} .*(LOG|STATEMENT|ERROR|WARNING):/.test(line)) flush();
      else plan.text.push(line.replace(/^\t/, ""));
    }
  }
  flush();
  const summary = {};
  for (const [name, plans] of Object.entries(sections)) {
    const seqScans = [];
    for (const p of plans) {
      const body = p.text.join("\n");
      for (const m of body.matchAll(
        /Seq Scan on (\w+)(?: \w+)? +\(cost=[^)]*\) \(actual time=[\d.]+\.\.([\d.]+) rows=([\d.]+)/g,
      )) {
        if (BIG.test(m[1])) seqScans.push({ table: m[1], ms: Number(m[2]), rows: Number(m[3]) });
      }
      const removed = [...body.matchAll(/Rows Removed by Filter: (\d+)/g)].reduce(
        (s, m) => s + Number(m[1]),
        0,
      );
      p.rowsRemovedByFilter = removed;
    }
    const sorted = [...plans].sort((a, b) => b.ms - a.ms);
    summary[name] = {
      statementsExplained: plans.length,
      totalMs: round(
        plans.reduce((s, p) => s + p.ms, 0),
        2,
      ),
      slowest: sorted.slice(0, 3).map((p) => ({
        ms: round(p.ms, 2),
        rowsRemovedByFilter: p.rowsRemovedByFilter,
        query: (p.text.find((l) => /Query Text:/.test(l)) ?? "")
          .replace(/.*Query Text:\s*/, "")
          .slice(0, 200),
      })),
      seqScansOnLargeTables: seqScans,
    };
  }
  return { summary, sections };
}

/** Sessions (connections) ever opened to the perf database (pg_stat_database, PG 14+). */
export function sessionsOpened() {
  return Number(psql(`select sessions from pg_stat_database where datname = '${DB}'`));
}

export function pgVersion() {
  return psql("show server_version");
}

export function logPg(msg) {
  log(`  [pg] ${msg}`);
}
