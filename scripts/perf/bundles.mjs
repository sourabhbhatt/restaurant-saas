/**
 * First-load JavaScript per route, from a production `next build` (Turbopack).
 *
 * For every App Router page, the client reference manifest
 * (.next/server/app/<route>/page_client-reference-manifest.js) lists the JS
 * chunks each segment of the route needs (`entryJSFiles`: root layout, nested
 * layouts, error/not-found boundaries and the page). First-load JS is the union
 * of those chunks plus the framework's `rootMainFiles` from build-manifest.json
 * (polyfills are `nomodule` and skipped by modern browsers, so they are not
 * counted). Sizes are raw bytes and gzip (zlib level 6, what `next start`
 * compression sends).
 *
 * Usage: node scripts/perf/bundles.mjs [--json out.json]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FRONTENDS = ["console", "ops", "admin"];

const sizeCache = new Map();
function sizes(file) {
  let s = sizeCache.get(file);
  if (!s) {
    const buf = readFileSync(file);
    s = { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 6 }).length };
    sizeCache.set(file, s);
  }
  return s;
}

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}

/** "/(public)/pricing/page" -> "/pricing"; "/page" -> "/". */
function routeName(key) {
  const r = key
    .replace(/\/page$/, "")
    .split("/")
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .join("/");
  return `/${r}`;
}

export function analyzeApp(app) {
  const next = path.join(ROOT, "apps", app, ".next");
  const buildManifest = JSON.parse(readFileSync(path.join(next, "build-manifest.json"), "utf8"));
  const rootMain = buildManifest.rootMainFiles ?? [];
  const routes = [];
  for (const file of walk(path.join(next, "server", "app"), (n) =>
    n.endsWith("page_client-reference-manifest.js"),
  )) {
    const sandbox = { globalThis: {} };
    sandbox.self = sandbox.globalThis;
    vm.runInNewContext(readFileSync(file, "utf8"), sandbox);
    const manifests = sandbox.globalThis.__RSC_MANIFEST ?? {};
    for (const [key, m] of Object.entries(manifests)) {
      if (key.startsWith("/_")) continue; // _not-found, _global-error
      const js = new Set(rootMain);
      for (const files of Object.values(m.entryJSFiles ?? {})) for (const f of files) js.add(f);
      const css = new Set();
      for (const files of Object.values(m.entryCSSFiles ?? {}))
        for (const f of files) css.add(typeof f === "string" ? f : f.path);
      let raw = 0;
      let gzip = 0;
      for (const f of js) {
        const s = sizes(path.join(next, f));
        raw += s.raw;
        gzip += s.gzip;
      }
      let cssGzip = 0;
      for (const f of css) {
        const p = path.join(next, f.replace(/^\/?_next\//, ""));
        try {
          cssGzip += sizes(p).gzip;
        } catch {
          // CSS path formats vary between Next versions; skip what does not resolve.
        }
      }
      routes.push({ route: routeName(key), chunks: js.size, jsRaw: raw, jsGzip: gzip, cssGzip });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  const chunkFiles = walk(path.join(next, "static", "chunks"), (n) => n.endsWith(".js"));
  let totalRaw = 0;
  let totalGzip = 0;
  for (const f of chunkFiles) {
    const s = sizes(f);
    totalRaw += s.raw;
    totalGzip += s.gzip;
  }
  let shared = { raw: 0, gzip: 0 };
  for (const f of rootMain) {
    const s = sizes(path.join(next, f));
    shared = { raw: shared.raw + s.raw, gzip: shared.gzip + s.gzip };
  }
  return {
    app,
    rootMain: { files: rootMain.length, ...shared },
    clientChunks: { files: chunkFiles.length, raw: totalRaw, gzip: totalGzip },
    routes,
  };
}

export function analyzeAll() {
  return FRONTENDS.map(analyzeApp);
}

const kb = (n) => (n / 1024).toFixed(1);

export function bundlesMarkdown(result) {
  const lines = [];
  for (const a of result) {
    lines.push(
      `\n#### ${a.app}: ${a.clientChunks.files} client chunks, ${kb(a.clientChunks.raw)} KB raw / ${kb(a.clientChunks.gzip)} KB gzip in total; framework root chunks ${kb(a.rootMain.gzip)} KB gzip\n`,
    );
    lines.push("| Route | Chunks | First-load JS (gzip KB) | Raw KB | CSS (gzip KB) |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const r of a.routes)
      lines.push(
        `| ${r.route} | ${r.chunks} | ${kb(r.jsGzip)} | ${kb(r.jsRaw)} | ${kb(r.cssGzip)} |`,
      );
  }
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = analyzeAll();
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(result, null, 2));
  console.log(bundlesMarkdown(result));
}
