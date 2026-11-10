/**
 * Lighthouse (lab) against the production servers. Each target runs `runs`
 * times in a fresh headless Chrome (Playwright's bundled Chromium via
 * CHROME_PATH) and the median of each metric is reported. Mobile targets use
 * Lighthouse's default mobile emulation and simulated throttling (Moto G
 * Power, slow 4G, 4x CPU); desktop targets use `--preset=desktop`. Signed-in
 * pages get the session cookie through `--extra-headers`.
 * TBT is the lab proxy for INP; TTFB is the `server-response-time` audit.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, median, ORIGINS, round, run } from "./lib.mjs";

export const LIGHTHOUSE = process.env.PERF_LIGHTHOUSE ?? "lighthouse@13.5.0";

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(homedir(), "Library/Caches/ms-playwright");
  const linuxBase = path.join(homedir(), ".cache/ms-playwright");
  for (const dir of [base, linuxBase]) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort();
    for (const b of builds.reverse()) {
      for (const rel of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
      ]) {
        const p = path.join(dir, b, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error(
    "No Chromium found: set CHROME_PATH or run `pnpm exec playwright install chromium`",
  );
}

export function targets(ctx, cookies) {
  const b = ctx.branches[0];
  return [
    { name: "console landing /", url: `${ORIGINS.console}/`, form: "mobile" },
    { name: "console pricing", url: `${ORIGINS.console}/pricing`, form: "mobile" },
    { name: "console features", url: `${ORIGINS.console}/features`, form: "mobile" },
    { name: "console sign-in", url: `${ORIGINS.console}/sign-in`, form: "mobile" },
    {
      name: "owner dashboard /app/w/:id",
      url: `${ORIGINS.console}/app/w/${ctx.workspaceId}`,
      form: "desktop",
      cookie: cookies.owner,
    },
    {
      name: "guest QR menu /t/:token",
      url: `${ORIGINS.console}/t/${b.qr.T1.token}`,
      form: "mobile",
    },
    {
      name: "ops waiter /waiter/:id",
      url: `${ORIGINS.ops}/waiter/${b.id}`,
      form: "mobile",
      cookie: cookies.waiter,
    },
    {
      name: "ops kitchen /kitchen/:id",
      url: `${ORIGINS.ops}/kitchen/${b.id}`,
      form: "desktop",
      cookie: cookies.kitchen,
    },
    {
      name: "admin home /admin",
      url: `${ORIGINS.admin}/admin`,
      form: "desktop",
      cookie: cookies.admin,
    },
  ];
}

const METRICS = {
  performance: (r) => (r.categories?.performance?.score ?? null) * 100,
  lcpMs: (r) => r.audits["largest-contentful-paint"]?.numericValue,
  cls: (r) => r.audits["cumulative-layout-shift"]?.numericValue,
  tbtMs: (r) => r.audits["total-blocking-time"]?.numericValue,
  fcpMs: (r) => r.audits["first-contentful-paint"]?.numericValue,
  ttfbMs: (r) => r.audits["server-response-time"]?.numericValue,
  speedIndexMs: (r) => r.audits["speed-index"]?.numericValue,
  scriptKB: (r) =>
    (r.audits["network-requests"]?.details?.items ?? [])
      .filter((i) => i.resourceType === "Script")
      .reduce((s, i) => s + (i.transferSize ?? 0), 0) / 1024,
  totalKB: (r) => (r.audits["total-byte-weight"]?.numericValue ?? 0) / 1024,
  requests: (r) => (r.audits["network-requests"]?.details?.items ?? []).length,
};

/** Runs every target `runs` times; raw JSON reports go to `outDir/lighthouse`. */
export function lighthouseSuite(ctx, cookies, outDir, runs = 3) {
  const dir = path.join(outDir, "lighthouse");
  mkdirSync(dir, { recursive: true });
  const env = { CHROME_PATH: chromePath() };
  const results = {};
  for (const t of targets(ctx, cookies)) {
    const per = [];
    const slug = t.name
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    for (let i = 1; i <= runs; i++) {
      const file = path.join(dir, `${slug}-${i}.json`);
      const args = [
        "-y",
        LIGHTHOUSE,
        t.url,
        "--quiet",
        "--only-categories=performance",
        "--output=json",
        `--output-path=${file}`,
        "--chrome-flags=--headless=new --no-sandbox --no-first-run",
        "--max-wait-for-load=45000",
      ];
      if (t.form === "desktop") args.push("--preset=desktop");
      if (t.cookie) {
        const headers = path.join(dir, `${slug}-headers.json`);
        writeFileSync(headers, JSON.stringify({ Cookie: t.cookie }));
        args.push(`--extra-headers=${headers}`);
      }
      const res = run("npx", args, { env, capture: true, allowFail: true });
      if (!existsSync(file)) {
        per.push({ error: `lighthouse exited ${res.status}: ${(res.stderr || "").slice(-300)}` });
        continue;
      }
      const report = JSON.parse(readFileSync(file, "utf8"));
      const m = {};
      for (const [k, f] of Object.entries(METRICS)) m[k] = f(report);
      m.finalUrl = report.finalDisplayedUrl ?? report.finalUrl;
      m.runtimeError = report.runtimeError?.code ?? null;
      m.warnings = report.runWarnings ?? [];
      per.push(m);
    }
    // Session cookies are local-only, but they do not belong in saved output.
    rmSync(path.join(dir, `${slug}-headers.json`), { force: true });
    const ok = per.filter((p) => !p.error);
    const med = {};
    for (const k of Object.keys(METRICS))
      med[k] = round(median(ok.map((p) => p[k])), k === "cls" ? 3 : 0);
    results[t.name] = {
      url: t.url.replace(/\/t\/[^/]+$/, "/t/<token>"),
      form: t.form,
      runs: per.length,
      ok: ok.length,
      median: med,
      finalUrl: ok[0]?.finalUrl?.replace(/\/t\/[^/?]+/, "/t/<token>") ?? null,
      warnings: [...new Set(ok.flatMap((p) => p.warnings))].slice(0, 3),
      errors: per.filter((p) => p.error).map((p) => p.error),
    };
    log(
      `  ${t.name}: perf ${med.performance} LCP ${med.lcpMs} CLS ${med.cls} TBT ${med.tbtMs} FCP ${med.fcpMs} TTFB ${med.ttfbMs} JS ${med.scriptKB} KB (${ok.length}/${per.length} ok)`,
    );
  }
  return results;
}
