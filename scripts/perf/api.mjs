/**
 * API latency against a running API (`next start`) seeded with the perf
 * dataset. Requests go straight to the API port (no frontend proxy), with
 * keep-alive, from this one Node process. Latency is wall time per request
 * (performance.now around fetch + body read); percentiles are nearest-rank.
 *
 * Reads run twice: concurrency 1 (uncontended latency) and concurrency 8
 * (a busy branch: several screens polling at once). Writes run sequentially;
 * guest orders are capped by the API's own rate limits (20 per session and
 * 60 per IP per 10 minutes), so that sample is small by design.
 */
import { ORIGINS, log, percentile, round } from "./lib.mjs";

const API = `${ORIGINS.api}/api/v1`;

/**
 * fetch with one retry on a network error: undici may reuse a keep-alive socket
 * the server has just closed (EPIPE/ECONNRESET). Every request here is safe to
 * repeat (reads, or writes carrying an idempotency key).
 */
async function http(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return fetch(url, init);
  }
}

function cookieFrom(res, name) {
  const all = res.headers.getSetCookie?.() ?? [];
  for (const c of all) if (c.startsWith(`${name}=`)) return c.split(";")[0];
  throw new Error(`No ${name} cookie in response (${res.status})`);
}

export async function signIn(email, password) {
  const res = await http(`${API}/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINS.console },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in ${email} failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res, "ros_session");
}

export async function joinGuest(token) {
  const res = await http(`${API}/public/qr/${token}/session`, {
    method: "POST",
    headers: { origin: ORIGINS.console, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`guest join failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res, "ros_guest");
}

export const DEMO = {
  owner: ["owner@demo.local", "Demo-Owner-2026"],
  waiter: ["waiter@demo.local", "Demo-Staff-2026"],
  kitchen: ["kitchen@demo.local", "Demo-Staff-2026"],
  cashier: ["cashier@demo.local", "Demo-Staff-2026"],
  admin: ["admin@restaurantos.local", "ChangeMe-Admin-2026"],
};

export async function signInAll() {
  const out = {};
  for (const [role, [email, pw]] of Object.entries(DEMO)) out[role] = await signIn(email, pw);
  return out;
}

async function once(spec, i) {
  const init = {
    method: spec.method ?? "GET",
    headers: {
      origin: ORIGINS.console,
      ...(spec.cookie ? { cookie: spec.cookie } : {}),
      ...(spec.body ? { "content-type": "application/json" } : {}),
      // Distinct guests: the API trusts one proxy hop, so this is the client IP it rate-limits on.
      ...(spec.distinctClients
        ? { "x-forwarded-for": `10.${(i >>> 16) & 255}.${(i >>> 8) & 255}.${i & 255}` }
        : {}),
    },
    body: spec.body ? JSON.stringify(spec.body(i)) : undefined,
  };
  const t0 = performance.now();
  const res = await http(spec.url, init);
  const buf = await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
}

/** Fire `requests` requests with `concurrency` workers after `warmup` unmeasured ones. */
export async function load(spec, { requests, concurrency, warmup = 5 }) {
  for (let i = 0; i < warmup; i++) await once(spec, 100_000 + i);
  const lat = [];
  const statuses = {};
  let bytes = 0;
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= requests) return;
        const r = await once(spec, i);
        lat.push(r.ms);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        bytes = r.bytes;
      }
    }),
  );
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  return {
    requests,
    concurrency,
    statuses,
    responseBytes: bytes,
    rps: round((requests / wall) * 1000),
    p50: round(percentile(lat, 50)),
    p95: round(percentile(lat, 95)),
    p99: round(percentile(lat, 99)),
    max: round(lat[lat.length - 1]),
  };
}

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
function daysAgo(n) {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Read endpoints that screens poll or open, keyed by a stable name. */
export function readSpecs(ctx, cookies, guestCookie) {
  const b = ctx.branches[0];
  const today = todayIst();
  return {
    // 60 requests per minute per client IP: each request comes from its own address.
    "guest menu GET /public/qr/:token": {
      url: `${API}/public/qr/${b.qr.T2.token}`,
      distinctClients: true,
    },
    "guest session poll GET /public/session": { url: `${API}/public/session`, cookie: guestCookie },
    "kitchen feed GET /branches/:id/kitchen": {
      url: `${API}/branches/${b.id}/kitchen`,
      cookie: cookies.kitchen,
    },
    "waiter tables GET /branches/:id/sessions": {
      url: `${API}/branches/${b.id}/sessions`,
      cookie: cookies.waiter,
    },
    "waiter active orders GET /branches/:id/orders?status=active": {
      url: `${API}/branches/${b.id}/orders?status=PENDING,ACCEPTED,PREPARING,READY&limit=200`,
      cookie: cookies.waiter,
    },
    "bill GET /bills/:id": { url: `${API}/bills/${b.issuedBillId}`, cookie: cookies.cashier },
    "cashier queue GET /branches/:id/bills/queue": {
      url: `${API}/branches/${b.id}/bills/queue`,
      cookie: cookies.cashier,
    },
    "dashboard GET /workspaces/:id/analytics (today)": {
      url: `${API}/workspaces/${ctx.workspaceId}/analytics?from=${today}&to=${today}`,
      cookie: cookies.owner,
    },
    "analytics GET /workspaces/:id/analytics (30 days)": {
      url: `${API}/workspaces/${ctx.workspaceId}/analytics?from=${daysAgo(29)}&to=${today}`,
      cookie: cookies.owner,
    },
    "analytics GET /workspaces/:id/analytics (90 days)": {
      url: `${API}/workspaces/${ctx.workspaceId}/analytics?from=${daysAgo(89)}&to=${today}`,
      cookie: cookies.owner,
    },
    "branch live GET /branches/:id/analytics/live": {
      url: `${API}/branches/${b.id}/analytics/live`,
      cookie: cookies.owner,
    },
    "admin GET /admin/analytics": { url: `${API}/admin/analytics`, cookie: cookies.admin },
  };
}

let keySeq = 0;
const idemKey = (p) => `${p}${Date.now().toString(36)}${(keySeq++).toString(36)}perf`;

export function guestOrderSpec(ctx, guestCookie, branch = ctx.branches[0]) {
  return {
    method: "POST",
    url: `${API}/public/session/orders`,
    cookie: guestCookie,
    body: (i) => ({
      idempotencyKey: idemKey("g"),
      lines: [
        { menuItemId: branch.menuItemIds[Math.abs(i) % branch.menuItemIds.length], quantity: 1 },
        {
          menuItemId: branch.menuItemIds[(Math.abs(i) + 7) % branch.menuItemIds.length],
          quantity: 2,
        },
      ],
    }),
  };
}

export function staffOrderSpec(ctx, cookies, branch = ctx.branches[0]) {
  return {
    method: "POST",
    url: `${API}/branches/${branch.id}/orders`,
    cookie: cookies.waiter,
    body: (i) => ({
      idempotencyKey: idemKey("s"),
      tableId: branch.freeTableIds[Math.abs(i) % branch.freeTableIds.length],
      lines: [
        { menuItemId: branch.menuItemIds[Math.abs(i) % branch.menuItemIds.length], quantity: 1 },
        {
          menuItemId: branch.menuItemIds[(Math.abs(i) + 3) % branch.menuItemIds.length],
          quantity: 1,
        },
      ],
    }),
  };
}

/**
 * Full API suite. `counter` (optional) measures database statements for one
 * request: `await counter(() => fetch...)` -> { statements, ... }.
 */
export async function apiSuite(ctx, { counter, reads = {}, cookies: given } = {}) {
  const cookies = given ?? (await signInAll());
  const b = ctx.branches[0];
  const guestA = await joinGuest(b.qr.T1.token);
  const guestB = await joinGuest(b.qr.T2.token);
  const specs = readSpecs(ctx, cookies, guestA);
  const out = { reads: {}, writes: {}, queriesPerRequest: {} };

  for (const [name, spec] of Object.entries(specs)) {
    const first = await once(spec, 0);
    if (first.status >= 400) {
      out.reads[name] = { error: `HTTP ${first.status}` };
      log(`  ${name}: HTTP ${first.status}`);
      continue;
    }
    if (counter) out.queriesPerRequest[name] = await counter(() => once(spec, 0));
    const c1 = await load(spec, { requests: reads.c1 ?? 100, concurrency: 1 });
    const c8 = await load(spec, { requests: reads.c8 ?? 300, concurrency: 8 });
    out.reads[name] = { c1, c8 };
    const bad = [c1, c8].filter((r) => Object.keys(r.statuses).some((k) => Number(k) >= 400));
    log(
      `  ${name}: c1 p50 ${c1.p50} p95 ${c1.p95} | c8 p50 ${c8.p50} p95 ${c8.p95} ms${bad.length ? ` NON-2XX ${JSON.stringify(bad.map((r) => r.statuses))}` : ""}`,
    );
  }

  // Writes. Guest: 2 sessions x 17 orders (the API allows 20 per session per 10 minutes,
  // and the explain pass may already have placed one).
  const gA = guestOrderSpec(ctx, guestA);
  const gB = guestOrderSpec(ctx, guestB);
  if (counter)
    out.queriesPerRequest["guest order POST /public/session/orders"] = await counter(() =>
      once(gA, 0),
    );
  const g1 = await load(gA, { requests: 17, concurrency: 1, warmup: 0 });
  const g2 = await load(gB, { requests: 17, concurrency: 1, warmup: 0 });
  const merged = { ...g1, requests: 34, statuses: { ...g1.statuses } };
  for (const [k, v] of Object.entries(g2.statuses))
    merged.statuses[k] = (merged.statuses[k] ?? 0) + v;
  merged.p50 = round((g1.p50 + g2.p50) / 2);
  merged.p95 = Math.max(g1.p95, g2.p95);
  out.writes["guest order POST /public/session/orders"] = {
    c1: merged,
    note: "two sessions, 17 + 17 sequential orders; p50 is the mean of the two runs' medians, p95 the larger",
  };
  log(`  guest order: p50 ${merged.p50} p95 ${merged.p95} ms ${JSON.stringify(merged.statuses)}`);

  const staff = staffOrderSpec(ctx, cookies);
  if (counter)
    out.queriesPerRequest["staff order POST /branches/:id/orders"] = await counter(() =>
      once(staff, 0),
    );
  const s1 = await load(staff, { requests: 40, concurrency: 1, warmup: 0 });
  const s4 = await load(staff, { requests: 60, concurrency: 4, warmup: 0 });
  out.writes["staff order POST /branches/:id/orders"] = { c1: s1, c4: s4 };
  log(`  staff order: c1 p50 ${s1.p50} p95 ${s1.p95} | c4 p50 ${s4.p50} p95 ${s4.p95} ms`);
  return out;
}

/** One request per endpoint, each wrapped by `around(name, request)` (used for plan capture). */
export async function explainPass(ctx, cookies, around) {
  const b = ctx.branches[0];
  const guest = await joinGuest(b.qr.T1.token);
  const specs = {
    ...readSpecs(ctx, cookies, guest),
    "guest order POST /public/session/orders": guestOrderSpec(ctx, guest),
    "staff order POST /branches/:id/orders": staffOrderSpec(ctx, cookies),
  };
  for (const [name, spec] of Object.entries(specs)) {
    // Warm read routes so the plan pass is not a cold module load; writes run once.
    if (!spec.body) await once(spec, 0);
    await around(name, () => once(spec, 1));
  }
}
