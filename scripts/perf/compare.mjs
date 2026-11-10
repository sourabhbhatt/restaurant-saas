/**
 * Baseline vs final tables from two summary.json files.
 * Usage: node scripts/perf/compare.mjs <baseline/summary.json> <final/summary.json> [> out.md]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fmt = (v, d = 0) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
function delta(a, b, d = 0) {
  if (a === null || a === undefined || b === null || b === undefined) return "–";
  const diff = b - a;
  const pct = a ? ` (${diff >= 0 ? "+" : ""}${Math.round((diff / a) * 100)}%)` : "";
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(d)}${pct}`;
}

function lighthouseTable(a, b) {
  const rows = [
    "| Page | Form | Perf score | LCP ms | CLS | TBT ms | FCP ms | TTFB ms | Script KB (transfer) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const name of Object.keys(b ?? a ?? {})) {
    const x = a?.[name]?.median ?? {};
    const y = b?.[name]?.median ?? {};
    const cell = (k, d = 0) => `${fmt(x[k], d)} → ${fmt(y[k], d)}`;
    rows.push(
      `| ${name} | ${(b ?? a)[name].form} | ${cell("performance")} | ${cell("lcpMs")} | ${cell("cls", 3)} | ${cell("tbtMs")} | ${cell("fcpMs")} | ${cell("ttfbMs")} | ${cell("scriptKB")} |`,
    );
  }
  return rows.join("\n");
}

function bundleTable(a, b) {
  const rows = [
    "| App | Route | First-load JS gzip KB (baseline → final) | Δ |",
    "| --- | --- | --- | --- |",
  ];
  for (const app of b ?? a ?? []) {
    const base = (a ?? []).find((x) => x.app === app.app);
    for (const r of app.routes) {
      const before = base?.routes.find((x) => x.route === r.route);
      const x = before ? before.jsGzip / 1024 : null;
      const y = r.jsGzip / 1024;
      if (x !== null && Math.abs(y - x) < 0.5) continue;
      rows.push(`| ${app.app} | ${r.route} | ${fmt(x, 1)} → ${fmt(y, 1)} | ${delta(x, y, 1)} |`);
    }
    if (base)
      rows.push(
        `| ${app.app} | all client chunks | ${fmt(base.clientChunks.gzip / 1024, 1)} → ${fmt(app.clientChunks.gzip / 1024, 1)} | ${delta(base.clientChunks.gzip / 1024, app.clientChunks.gzip / 1024, 1)} |`,
      );
  }
  return rows.join("\n");
}

function apiTable(a, b, title) {
  const rows = [
    `| ${title} | c1 p50 | c1 p95 | c8 p50 | c8 p95 |`,
    "| --- | --- | --- | --- | --- |",
  ];
  const names = Object.keys({ ...(a?.reads ?? {}), ...(b?.reads ?? {}) });
  for (const n of names) {
    const x = a?.reads?.[n] ?? {};
    const y = b?.reads?.[n] ?? {};
    const c = (r, k) => `${fmt(x[r]?.[k], 1)} → ${fmt(y[r]?.[k], 1)}`;
    rows.push(
      `| ${n} | ${c("c1", "p50")} | ${c("c1", "p95")} | ${c("c8", "p50")} | ${c("c8", "p95")} |`,
    );
  }
  for (const n of Object.keys({ ...(a?.writes ?? {}), ...(b?.writes ?? {}) })) {
    const x = a?.writes?.[n] ?? {};
    const y = b?.writes?.[n] ?? {};
    const hi = x.c4 || y.c4 ? "c4" : "c1";
    rows.push(
      `| ${n} | ${fmt(x.c1?.p50, 1)} → ${fmt(y.c1?.p50, 1)} | ${fmt(x.c1?.p95, 1)} → ${fmt(y.c1?.p95, 1)} | ${hi === "c4" ? `(c4) ${fmt(x.c4?.p50, 1)} → ${fmt(y.c4?.p50, 1)}` : "–"} | ${hi === "c4" ? `${fmt(x.c4?.p95, 1)} → ${fmt(y.c4?.p95, 1)}` : "–"} |`,
    );
  }
  return rows.join("\n");
}

function statementsTable(a, b) {
  const rows = [
    "| Endpoint | Statements / request | Transactions | Data statements |",
    "| --- | --- | --- | --- |",
  ];
  const qa = a?.queriesPerRequest ?? {};
  const qb = b?.queriesPerRequest ?? {};
  for (const n of Object.keys({ ...qa, ...qb })) {
    const x = qa[n] ?? {};
    const y = qb[n] ?? {};
    rows.push(
      `| ${n} | ${fmt(x.statements)} → ${fmt(y.statements)} | ${fmt(x.transactions)} → ${fmt(y.transactions)} | ${fmt(x.dataStatements)} → ${fmt(y.dataStatements)} |`,
    );
  }
  return rows.join("\n");
}

function coldTable(a, b) {
  const rows = [
    "| App | Start → healthy ms | First request ms | RSS MB | Standalone MB |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const app of Object.keys(b ?? a ?? {})) {
    const x = a?.[app] ?? {};
    const y = b?.[app] ?? {};
    rows.push(
      `| ${app} | ${fmt(x.toHealthyMs)} → ${fmt(y.toHealthyMs)} | ${fmt(x.firstRequestMs)} → ${fmt(y.firstRequestMs)} (${y.firstRequestPath ?? x.firstRequestPath}) | ${fmt(x.rssAfterFirstRequestMB)} → ${fmt(y.rssAfterFirstRequestMB)} | ${fmt(x.standaloneMB, 1)} → ${fmt(y.standaloneMB, 1)} |`,
    );
  }
  return rows.join("\n");
}

export function compareMarkdown(a, b) {
  return [
    `## Baseline (${a.label}, ${a.git}) vs ${b.label} (${b.git})`,
    "",
    "### Lighthouse (median of runs)",
    lighthouseTable(a.lighthouse, b.lighthouse),
    "",
    "### First-load JS per route (gzip; unchanged routes omitted)",
    bundleTable(a.bundles, b.bundles),
    "",
    "### API latency, PGlite (ms)",
    apiTable(a.apiPglite, b.apiPglite, "Endpoint (PGlite)"),
    "",
    "### API latency, Postgres 18 (throwaway local cluster) (ms)",
    apiTable(a.pg, b.pg, "Endpoint (Postgres 18)"),
    "",
    "### Database statements per request (Postgres 18, pg_stat_statements)",
    statementsTable(a.pg, b.pg),
    "",
    "### Cold start (standalone server.js, median)",
    coldTable(a.coldStart, b.coldStart),
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [x, y] = process.argv.slice(2);
  if (!x || !y) {
    console.error(
      "usage: node scripts/perf/compare.mjs <baseline summary.json> <final summary.json>",
    );
    process.exit(2);
  }
  console.log(
    compareMarkdown(JSON.parse(readFileSync(x, "utf8")), JSON.parse(readFileSync(y, "utf8"))),
  );
}
