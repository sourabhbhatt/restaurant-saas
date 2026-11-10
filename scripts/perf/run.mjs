#!/usr/bin/env node
/**
 * RestaurantOS performance harness: one command, local only, free tools.
 *
 *   pnpm perf --label final [--compare .data/perf-results/baseline/summary.json]
 *
 * Phases (all by default; pick with --phases a,b,c):
 *   build      pnpm build (all four apps, production)
 *   bundles    first-load JS per route from the build manifests (bundles.mjs)
 *   data       fresh PGlite dir .data/perf/pglite: demo seed + synthetic busy-restaurant dataset
 *   coldstart  standalone `node server.js` start-to-healthy, first request, output size
 *   lighthouse `next start` servers + Lighthouse (3 runs per page, median)
 *   api        API latency p50/p95 against PGlite (the default dev database)
 *   pg         Postgres 18 in a throwaway cluster (local binaries on 127.0.0.1:PERF_PG_PORT,
 *              or Docker): statements per request, EXPLAIN ANALYZE (auto_explain), API latency
 *              with the production role setup, connection churn under 10 s polling
 *
 * Safety: the API only ever gets the harness's own database (assertPerfDatabase in lib.mjs:
 * PGlite under .data/ or 127.0.0.1:PERF_PG_PORT), never a system Postgres on 5432.
 *
 * Output: --out <dir> (default .data/perf-results/<label>) with summary.json,
 * summary.md and raw files. Nothing leaves the machine; no cloud calls.
 * Options: --skip-build, --runs N (Lighthouse runs, default 3), --compare <summary.json>,
 * --keep-raw (keep every Lighthouse JSON report), --keep-next-cache (keep .next/cache after build).
 * Ports (env): PERF_API_PORT 4150, PERF_CONSOLE_PORT 3150, PERF_OPS_PORT 3151,
 * PERF_ADMIN_PORT 3152, PERF_PG_PORT 55150, PERF_COLDSTART_PORT 4159.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import { apiSuite, explainPass, signInAll } from "./api.mjs";
import { analyzeAll, bundlesMarkdown } from "./bundles.mjs";
import { coldStartSuite } from "./coldstart.mjs";
import { compareMarkdown } from "./compare.mjs";
import {
  apiEnv,
  assertPerfDatabase,
  frontendEnv,
  log,
  median,
  ORIGINS,
  PORTS,
  ROOT,
  run,
  start,
  stop,
  stopAll,
  waitFor,
} from "./lib.mjs";
import { chromePath, LIGHTHOUSE, lighthouseSuite } from "./lighthouse.mjs";
import * as pg from "./pg.mjs";

const { values: args } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    out: { type: "string" },
    phases: { type: "string", default: "build,bundles,data,coldstart,lighthouse,api,pg" },
    runs: { type: "string", default: "3" },
    "skip-build": { type: "boolean", default: false },
    "keep-raw": { type: "boolean", default: false },
    "keep-next-cache": { type: "boolean", default: false },
    // Lighthouse with the service worker allowed (not comparable across builds; see lighthouse.mjs).
    "allow-sw": { type: "boolean", default: false },
    // Read-latency series on Postgres; the summary keeps the median and the spread.
    series: { type: "string", default: "3" },
    compare: { type: "string" },
  },
});

const OUT = path.resolve(args.out ?? path.join(ROOT, ".data", "perf-results", args.label));
const PERF_DIR = path.join(ROOT, ".data", "perf", "pglite");
const phases = new Set(args.phases.split(",").map((p) => p.trim()));
if (args["skip-build"]) phases.delete("build");
mkdirSync(OUT, { recursive: true });

const summaryFile = path.join(OUT, "summary.json");
const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : {};
const save = () => writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
const pgliteEnv = { DATABASE_PROVIDER: "pglite", PGLITE_DATA_DIR: PERF_DIR };

function gitRev() {
  const r = run("git", ["rev-parse", "--short", "HEAD"], { capture: true, allowFail: true });
  const dirty = run("git", ["status", "--porcelain"], { capture: true, allowFail: true });
  return `${r.stdout.trim()}${dirty.stdout.trim() ? "+dirty" : ""}`;
}

function seed(dbEnv, extra = {}) {
  assertPerfDatabase({ ...dbEnv, ...extra });
  run("pnpm", ["db:seed"], { env: { ...dbEnv, ...extra }, capture: true });
  const res = run(tsx, ["scripts/perf/seed-large.ts"], { env: extra, capture: true });
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

function readContext(extra) {
  const res = run(
    tsx,
    ["--conditions=react-server", "--env-file=.env.local", "scripts/perf/context.ts"],
    {
      env: extra,
      capture: true,
    },
  );
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

async function startApi(dbEnv) {
  const api = start(
    "api",
    "pnpm",
    ["--filter", "@ros/api", "exec", "next", "start", "-p", String(PORTS.api)],
    {
      env: apiEnv(dbEnv),
    },
  );
  await waitFor(`${ORIGINS.api}/api/v1/health/ready`, { child: api, timeoutMs: 180_000 });
  return api;
}

async function startFrontends() {
  const procs = [];
  for (const app of ["console", "ops", "admin"]) {
    const p = start(
      app,
      "pnpm",
      ["--filter", `@ros/${app}`, "exec", "next", "start", "-p", String(PORTS[app])],
      {
        env: frontendEnv(),
      },
    );
    procs.push(p);
    await waitFor(`${ORIGINS[app]}/healthz`, { child: p, timeoutMs: 120_000 });
    await assertProxyServesJson(app);
  }
  return procs;
}

/**
 * Measurements of a page whose API calls fail are meaningless (an error state
 * can even look faster), so check that JSON relayed by the frontend's proxy
 * parses for a browser-like request before Lighthouse runs.
 */
async function assertProxyServesJson(app) {
  const res = await fetch(`${ORIGINS[app]}/api/v1/sync/ping`, {
    headers: { accept: "application/json", "accept-encoding": "gzip, deflate, br, zstd" },
  });
  const text = await res.text();
  try {
    JSON.parse(text);
  } catch {
    throw new Error(
      `perf: ${app} proxy returned non-JSON for /api/v1/sync/ping (status ${res.status}, ` +
        `content-encoding ${res.headers.get("content-encoding") ?? "none"}): ${JSON.stringify(text.slice(0, 40))}`,
    );
  }
}

let lighthouseCookies;

function noteLoad(phase) {
  summary.machine.load[phase] = os.loadavg().map((v) => Math.round(v * 100) / 100);
}

/** Entries and bytes the service worker precaches on install (from the prebuilt sw.js). */
function precacheStats() {
  const out = {};
  for (const app of ["console", "ops"]) {
    const next = path.join(ROOT, "apps", app, ".next");
    const swFile = path.join(next, "sw-prebuilt", "sw.js");
    if (!existsSync(swFile)) continue;
    const urls = [
      ...new Set(
        [...readFileSync(swFile, "utf8").matchAll(/"(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    let raw = 0;
    let gzip = 0;
    for (const u of urls) {
      const file = path.join(next, u.replace(/^\/_next\//, ""));
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      raw += bytes.length;
      gzip += gzipSync(bytes).length;
    }
    out[app] = {
      entries: urls.length,
      rawKB: Math.round(raw / 1024),
      gzipKB: Math.round(gzip / 1024),
    };
  }
  return out;
}

/** Bytes of the largest JSON payload (the guest menu), as served and as gzip would send it. */
async function payloadSizes(ctx) {
  const token = ctx.branches[0].qr.T2.token;
  const res = await fetch(`${ORIGINS.api}/api/v1/public/qr/${token}`, {
    headers: { "x-forwarded-for": "10.250.0.1", "accept-encoding": "gzip" },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    guestMenu: {
      status: res.status,
      contentEncoding: res.headers.get("content-encoding"),
      bytes: body.length,
      gzipBytes: gzipSync(body).length,
    },
  };
}

/**
 * Read latency over several series: per endpoint and metric, the median of the
 * series and their [min, max]. Statement counts and writes come from the first.
 */
function combineSeries(first, more) {
  const all = [first, ...more];
  const reads = {};
  const spread = {};
  for (const name of Object.keys(first.reads)) {
    if (first.reads[name].error) {
      reads[name] = first.reads[name];
      continue;
    }
    reads[name] = {};
    spread[name] = {};
    for (const level of ["c1", "c8"]) {
      const runs = all.map((r) => r.reads[name]?.[level]).filter(Boolean);
      reads[name][level] = { ...first.reads[name][level] };
      spread[name][level] = {};
      for (const k of ["p50", "p95"]) {
        const v = runs.map((r) => r[k]);
        reads[name][level][k] = median(v);
        spread[name][level][k] = [Math.min(...v), Math.max(...v)];
      }
    }
  }
  return { ...first, reads, readSeries: all.length, readSpread: spread };
}

/**
 * Connection churn under polling: one kitchen-feed request every 11 s (screens
 * poll every 10 s, plus jitter), counting the database sessions the API opens.
 * A pool whose idle timeout is shorter than the gap reconnects on every poll.
 */
async function measurePoolChurn(ctx, cookies, requests = 6, gapMs = 11_000) {
  const url = `${ORIGINS.api}/api/v1/branches/${ctx.branches[0].id}/kitchen`;
  const get = async () =>
    (await fetch(url, { headers: { cookie: cookies.kitchen } })).arrayBuffer();
  await get();
  const before = pg.sessionsOpened();
  for (let i = 0; i < requests; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    await get();
  }
  // Minus one: the psql session that reads the counter the second time.
  const opened = pg.sessionsOpened() - before - 1;
  log(
    `  [pg] pool churn: ${opened} new connections for ${requests} requests ${gapMs / 1000} s apart`,
  );
  return { requests, gapMs, connectionsOpened: opened };
}

async function main() {
  summary.label = args.label;
  summary.git = gitRev();
  summary.startedAt = new Date().toISOString();
  summary.machine = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? null,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    // 1/5/15-minute load averages at the start of each phase (other work on the machine).
    load: {},
  };
  log(`output: ${OUT} (git ${summary.git})`);

  if (phases.has("build")) {
    log("build: pnpm build --force (no Turbo cache replay, so output sizes are comparable)");
    noteLoad("build");
    const t0 = performance.now();
    run("pnpm", ["build", "--concurrency=2", "--force"], { env: { NEXT_TELEMETRY_DISABLED: "1" } });
    summary.buildSeconds = Math.round((performance.now() - t0) / 1000);
    // Disk: the Turbopack cache (~100 MB per app) only speeds up the next build.
    if (!args["keep-next-cache"])
      for (const app of ["api", "console", "ops", "admin"])
        rmSync(path.join(ROOT, "apps", app, ".next", "cache"), { recursive: true, force: true });
    save();
  }

  if (phases.has("bundles")) {
    log("bundles");
    const result = analyzeAll();
    writeFileSync(path.join(OUT, "bundles.json"), JSON.stringify(result, null, 2));
    summary.bundles = result;
    summary.precache = precacheStats();
    for (const [app, p] of Object.entries(summary.precache))
      log(
        `  ${app} service worker precache: ${p.entries} entries, ${p.rawKB} KB raw, ${p.gzipKB} KB gzip`,
      );
    save();
  }

  if (phases.has("data") || !existsSync(path.join(OUT, "context.json"))) {
    log("data: fresh PGlite perf dataset");
    rmSync(path.join(ROOT, ".data", "perf"), { recursive: true, force: true });
    summary.dataset = seed({}, pgliteEnv);
    writeFileSync(path.join(OUT, "context.json"), JSON.stringify(readContext(pgliteEnv)));
    save();
  }
  const ctx = JSON.parse(readFileSync(path.join(OUT, "context.json"), "utf8"));

  try {
    if (phases.has("coldstart")) {
      log("coldstart: standalone servers");
      summary.coldStart = await coldStartSuite(pgliteEnv);
      save();
    }

    if (phases.has("lighthouse") || phases.has("api")) {
      log("servers: next start (api on PGlite, console, ops, admin)");
      let api = await startApi(pgliteEnv);
      if (phases.has("lighthouse")) {
        await startFrontends();
        lighthouseCookies = await signInAll();
        const cookies = lighthouseCookies;
        log(
          `lighthouse: ${LIGHTHOUSE}, ${args.runs} runs per page, service worker ${args["allow-sw"] ? "allowed" : "blocked"}, chrome ${chromePath()}`,
        );
        noteLoad("lighthouse");
        summary.lighthouse = lighthouseSuite(
          ctx,
          cookies,
          OUT,
          Number(args.runs),
          args["keep-raw"],
          { blockServiceWorker: !args["allow-sw"] },
        );
        save();
      }
      if (phases.has("api")) {
        // A fresh API process: latency is not measured on a heap warmed (or worn) by Lighthouse.
        if (api.exitCode !== null)
          log(`  api exited during lighthouse:\n${api.output.slice(-3000)}`);
        await stop(api);
        api = await startApi(pgliteEnv);
        log("api: latency on PGlite (single embedded connection; not a production number)");
        noteLoad("api");
        summary.apiPglite = await apiSuite(ctx, { cookies: lighthouseCookies });
        summary.payloads = await payloadSizes(ctx);
        log(`  guest menu payload: ${JSON.stringify(summary.payloads.guestMenu)}`);
        save();
      }
      await stopAll();
    }

    if (phases.has("pg")) {
      const backend = pg.detectBackend();
      if (!backend) {
        log("pg: no Postgres 18 binaries and no working Docker, skipped");
        summary.pg = { skipped: "no Postgres 18 binaries (PERF_PG_BIN) and no working Docker" };
      } else {
        log(`pg: Postgres 18 (${backend}) on 127.0.0.1:${PORTS.pg}`);
        await pg.startPostgres();
        try {
          const owner = { DATABASE_PROVIDER: "postgres", DATABASE_URL: pg.OWNER_URL };
          run("pnpm", ["db:migrate"], { env: owner, capture: true });
          const dataset = seed(owner, { ...owner, PERF_DATABASE_URL: pg.OWNER_URL });
          const roleCheck = pg.preparePostgres();
          log(`  [pg] runtime role can read the migration journal: ${JSON.stringify(roleCheck)}`);
          const pctx = readContext({ ...owner, PERF_DATABASE_URL: pg.OWNER_URL });
          const runtime = { DATABASE_PROVIDER: "postgres", DATABASE_URL: pg.RUNTIME_URL };
          const coldStartApi = await coldStartSuite(runtime, 5, ["api"]);
          await startApi(runtime);
          const version = pg.pgVersion();
          // Plans: one request per endpoint with auto_explain on.
          const cookies = await signInAll();
          pg.setAutoExplain(true);
          const marks = [];
          await explainPass(pctx, cookies, async (name, request) => {
            pg.markLog(`ep${marks.length}`);
            marks.push(name);
            await request();
          });
          pg.setAutoExplain(false);
          const plans = pg.collectPlans();
          const byEndpoint = {};
          marks.forEach((ep, i) => (byEndpoint[ep] = plans.summary[`ep${i}`]));
          writeFileSync(
            path.join(OUT, "pg-plans-raw.json"),
            JSON.stringify(plans.sections, null, 1),
          );
          // Statement counts and latency with auto_explain off.
          await stopAll();
          await startApi(runtime);
          noteLoad("pg");
          const first = await apiSuite(pctx, { counter: pg.countStatements, cookies });
          const more = [];
          for (let i = 1; i < Number(args.series); i++) {
            log(`  [pg] read series ${i + 1} of ${args.series}`);
            more.push(await apiSuite(pctx, { cookies, writes: false }));
          }
          const result = combineSeries(first, more);
          const poolChurn = await measurePoolChurn(pctx, cookies);
          summary.pg = {
            poolChurn,
            version,
            backend,
            dataset,
            roleCheck,
            coldStartApi,
            plans: byEndpoint,
            ...result,
          };
          save();
        } finally {
          await stopAll();
          pg.stopPostgres();
        }
      }
    }
  } finally {
    await stopAll();
  }

  summary.finishedAt = new Date().toISOString();
  save();
  const md = [
    `# Perf run ${summary.label} (${summary.git})`,
    "",
    bundlesMarkdown(summary.bundles ?? []),
  ];
  if (args.compare)
    md.unshift(compareMarkdown(JSON.parse(readFileSync(args.compare, "utf8")), summary), "");
  writeFileSync(path.join(OUT, "summary.md"), md.join("\n"));
  log(`done: ${summaryFile}`);
}

main().catch(async (error) => {
  console.error(error);
  await stopAll();
  process.exit(1);
});
