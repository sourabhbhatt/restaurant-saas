/**
 * Cold start of the standalone servers (what the Docker image runs:
 * `node apps/<app>/server.js`). For each app and run: spawn the process,
 * poll the liveness URL every 10 ms until it answers 200, then time the first
 * real request (API: /api/v1/health/ready, which builds the container and
 * opens the database; frontends: the landing/sign-in page). Also reports the
 * standalone output size (server + traced node_modules) plus static assets,
 * i.e. what the runtime image layer copies.
 */
import path from "node:path";

import {
  apiEnv,
  dirBytes,
  frontendEnv,
  log,
  median,
  round,
  ROOT,
  start,
  stop,
  waitFor,
} from "./lib.mjs";

const PORT = Number(process.env.PERF_COLDSTART_PORT ?? 4159);

const APPS = {
  api: { health: "/api/v1/health", first: "/api/v1/health/ready" },
  console: { health: "/healthz", first: "/sign-in" },
  ops: { health: "/healthz", first: "/sign-in" },
  admin: { health: "/healthz", first: "/sign-in" },
};

export async function coldStartSuite(dbEnv, runs = 5, apps = Object.keys(APPS)) {
  const out = {};
  for (const app of apps) {
    const paths = APPS[app];
    const standalone = path.join(ROOT, "apps", app, ".next", "standalone");
    const server = path.join(standalone, "apps", app, "server.js");
    const env = {
      ...(app === "api" ? apiEnv(dbEnv) : frontendEnv()),
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
    };
    const toHealthy = [];
    const firstRequest = [];
    const rss = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const child = start(`${app}-standalone`, process.execPath, [server], {
        env,
        cwd: standalone,
      });
      try {
        await waitFor(`http://127.0.0.1:${PORT}${paths.health}`, { child, intervalMs: 10 });
        toHealthy.push(performance.now() - t0);
        const t1 = performance.now();
        const res = await fetch(`http://127.0.0.1:${PORT}${paths.first}`);
        await res.arrayBuffer();
        if (res.status >= 500)
          throw new Error(`${app} ${paths.first} -> ${res.status}\n${child.output.slice(-2000)}`);
        firstRequest.push(performance.now() - t1);
        const ps = await import("node:child_process").then((cp) =>
          cp.execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }),
        );
        rss.push(Number(ps.trim()) / 1024);
      } finally {
        await stop(child);
      }
    }
    const sizes = {
      standaloneMB: round(dirBytes(standalone) / 1048576),
      nodeModulesMB: round(dirBytes(path.join(standalone, "node_modules")) / 1048576),
      staticMB: round((dirBytes(path.join(ROOT, "apps", app, ".next", "static")) ?? 0) / 1048576),
      publicMB: round((dirBytes(path.join(ROOT, "apps", app, "public")) ?? 0) / 1048576),
    };
    out[app] = {
      runs,
      toHealthyMs: round(median(toHealthy), 0),
      firstRequestMs: round(median(firstRequest), 0),
      firstRequestPath: paths.first,
      rssAfterFirstRequestMB: round(median(rss), 0),
      all: {
        toHealthy: toHealthy.map((v) => round(v, 0)),
        firstRequest: firstRequest.map((v) => round(v, 0)),
      },
      ...sizes,
    };
    log(
      `  ${app}: healthy ${out[app].toHealthyMs} ms, first ${paths.first} ${out[app].firstRequestMs} ms, rss ${out[app].rssAfterFirstRequestMB} MB, standalone ${sizes.standaloneMB} MB`,
    );
  }
  return out;
}
