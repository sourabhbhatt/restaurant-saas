# Performance report

Audit of 2026-11-10, workstream W6 (performance). Base commit `97467e8`. "Final" is the
integration branch at `8d32091` (all six audit workstreams) merged with the W6 branch at
`6b0fabf`. Every number here comes from `pnpm perf` (`scripts/perf/`) or one of the probe
scripts named below, run locally on an Apple M4 Pro (12 cores, 24 GB, Node 24.4.1). Nothing
was sent to a cloud service. Raw output is in the W6 worktree under `.claude/audit/W6-raw/`
(git-ignored); the file behind each table is named in its heading.

## Method

`pnpm perf --label <name> [--compare <baseline summary.json>]` runs these phases:

| Phase      | What it measures                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| build      | `turbo run build --force` for api, console, ops and admin (no cache replay, so output sizes compare)                                                                                                                                                                   |
| bundles    | First-load JS per route from the build manifests; the service worker's precache list and its bytes                                                                                                                                                                     |
| data       | Fresh PGlite at `.data/perf/pglite`: demo seed plus a synthetic busy restaurant                                                                                                                                                                                        |
| coldstart  | Standalone `node server.js`: start to healthy, first request, RSS, output size (median of 5)                                                                                                                                                                           |
| lighthouse | Lighthouse 13.5.0 against `next start`, 3 runs per page, median, **service worker blocked** (`--blocked-url-patterns=*/serwist/sw.js`); also the observed (not simulated) start of the first API request and the end of the first API response, per run                |
| api        | API latency on PGlite, p50/p95 at concurrency 1 (100 requests) and 8 (300 requests) after 5 warm-up requests; the guest menu's size as served and as gzip                                                                                                              |
| pg         | Postgres 18.4 in a throwaway local cluster (127.0.0.1:55150, own data dir, the production roles): statements per request (`pg_stat_statements`), every plan (`auto_explain`), read latency in **3 series** (median and min–max), connections opened under 10 s polling |

Dataset (deterministic): 2 branches, 318 menu items with variants and add-ons, 80 tables, 100
days at 40 sessions per branch per day (8,104 sessions, 20,224 orders, 60,601 order lines, 7,868
bills, 7,864 payments) and a live service.

Lighthouse uses its mobile profile (simulated slow 4G) for public, guest and waiter pages and
the desktop preset for the dashboard, kitchen and admin. Simulated LCP differs by up to about
1,050 ms between the three runs of one page here (guest, base: 4207–5259 ms), so treat
smaller differences as noise.

Guard rails: the harness only accepts its own databases (PGlite under `.data/`, or
127.0.0.1:55150), and so do the seed scripts. It checks that each frontend's proxy returns
parseable JSON to a browser-like request before Lighthouse runs, and records the load average at
the start of each phase.

**Run conditions.** Other workstreams' builds, tests and reviews ran on the same machine. Load
average (1 min) at phase start: baseline 1.9 (build), 4.1 (Lighthouse), 5.0 (API), 2.2 (pg);
final 8.1, 5.8, **35.2** and 8.7. The final PGlite latency was measured under that load and is
not comparable. The Postgres read series overlap within their min–max spread except where a
plan changed.

Baseline is `97467e8` checked out detached, with its own lockfile install and the same harness
copied in (`baseline-v2`). Final is `final-v5`.

## Results: baseline → final (`compare-baseline-v2-final-v5.md`)

### Lighthouse (median of 3, service worker blocked)

| Page                         | Form    | Perf     | LCP ms      | CLS           | TBT ms  | Script KB | First API request ms (observed) |
| ---------------------------- | ------- | -------- | ----------- | ------------- | ------- | --------- | ------------------------------- |
| Landing `/`                  | mobile  | 89 → 92  | 3758 → 3371 | 0 → 0         | 16 → 7  | 357 → 398 | 84 → none                       |
| Pricing                      | mobile  | 87 → 91  | 4061 → 3513 | 0 → 0         | 14 → 14 | 367 → 415 | 87 → none                       |
| Features                     | mobile  | 90 → 92  | 3682 → 3368 | 0 → 0         | 28 → 8  | 290 → 301 | 73 → none                       |
| Sign-in                      | mobile  | 85 → 86  | 4362 → 4215 | 0.011 → 0     | 29 → 13 | 345 → 408 | 83 → 338                        |
| Guest QR menu `/t/:token`    | mobile  | 83 → 82  | 4809 → 4813 | 0 → 0         | 59 → 51 | 319 → 330 | 72 → 347                        |
| Waiter `/waiter/:id`         | mobile  | 84 → 86  | 4506 → 4225 | 0.002 → 0.001 | 48 → 60 | 364 → 374 | 79 → 75                         |
| Owner dashboard `/app/w/:id` | desktop | 96 → 96  | 888 → 797   | 0.117 → 0.117 | 0 → 0   | 506 → 425 | 87 → 72                         |
| Kitchen `/kitchen/:id`       | desktop | 97 → 100 | 804 → 816   | 0.106 → 0.001 | 0 → 0   | 296 → 334 | 87 → 101                        |
| Admin `/admin`               | desktop | 98 → 98  | 1154 → 1091 | 0 → 0         | 0 → 0   | 505 → 502 | 99 → 123                        |

Public pages make no API request any more: they no longer run the offline runtime (no
connectivity ping), and pricing now renders its plans on the server (W4).

Waiter data arrives at 108 ms instead of 348 ms (first API response, observed).

Sign-in and guest start their first request late in 2 of 3 Lighthouse runs (`perRun` in
`final-v5/summary.json`: sign-in 118, 362, 338 ms; guest 81, 347, 358 ms). In plain headless
Chromium, 20 loads each (`guest-timing.json`), final and base do not differ:

| Page    | Base: median, loads over 250 ms | Final: median, loads over 250 ms |
| ------- | ------------------------------- | -------------------------------- |
| Guest   | 66 ms, 2 of 20                  | 57 ms, 0 of 20                   |
| Sign-in | 76 ms, 1 of 20                  | 78 ms, 1 of 20                   |

The late loads sit about 300 ms after load, which is React's Suspense retry throttle, and they
occur on the base build too. A slower main thread (Lighthouse tracing) makes them more likely.
See open item 6.

### First-load JS per route (gzip KB; `final-v5/bundles.json`)

| App     | Route                                 |  Base | Final | Change |
| ------- | ------------------------------------- | ----: | ----: | -----: |
| console | `/`                                   | 271.6 | 269.8 |   −1.8 |
| console | `/pricing`                            | 272.0 | 269.9 |   −2.1 |
| console | `/features` (and other content pages) | 225.5 | 254.3 |  +28.8 |
| console | `/sign-in`                            | 303.8 | 328.5 |  +24.7 |
| console | `/t/[token]` (guest)                  | 303.8 | 285.0 |  −18.8 |
| console | `/app/b/[branchId]`                   | 464.7 | 359.5 | −105.2 |
| console | `/app/w/[workspaceId]/analytics`      | 473.4 | 364.9 | −108.5 |
| console | `/app/w/[workspaceId]`                | 353.7 | 360.4 |   +6.7 |
| ops     | `/kitchen/[branchId]`                 | 282.6 | 318.0 |  +35.4 |
| ops     | `/waiter/[branchId]`                  | 349.7 | 356.7 |   +7.0 |
| admin   | `/admin`                              | 390.5 | 312.9 |  −77.6 |

These totals include every workstream. W6's own share comes from the runs taken before the
integration merges (`baseline/` vs `final/`, computed in `attribution.json`):

- The offline runtime left the public pages: −34.4 KB on every public page.
- zod/mini in the plans parser: −7.6 KB, pricing only.
- Lazy guest sheets and tabs: −20.4 KB, guest only.
- Lazy Recharts plots: −109.6 KB branch overview, −109.5 KB workspace analytics, −111.9 KB admin
  home.

The public pages grew after the merges. On `/features`, the root layout now ships full zod in
two chunks (22.8 and 11.5 KB gzip), reached from the GA4 tracking client through
`@ros/contracts/tracking-events` (open item 1).

### Postgres 18 (`final-v5/summary.json`, `pg-plans-raw.json`)

| Query or measure                                  | Base                                                | Final                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kitchen "recently done" list (every kitchen poll) | sequential scan of `orders`, 2.11 ms, 1,620 buffers | bitmap OR of `orders_branch_done_recent_idx` and `orders_branch_cancelled_at_idx`, 0.105 ms, 32 buffers |
| Open bills (cashier queue, bill page)             | sequential scan of `bills`, 0.583 ms, 441 buffers   | index scan on `bills_branch_open_idx`, 0.022 ms, 5 buffers                                              |
| Connections opened for 6 kitchen polls 11 s apart | 12                                                  | 0                                                                                                       |
| Statements per request (all 14 endpoints)         | 8–16                                                | unchanged                                                                                               |
| Kitchen feed, c1 p50 (3 series, min–max)          | 9.5 ms [7.1–9.8]                                    | 7.6 ms [5.5–8.2]                                                                                        |

The plans were taken under the production roles (`ros_runtime` switching to `ros_tenant`, RLS
on). The other endpoints' read latency overlaps within the series spread (full table in the
comparison file). The pool change is W1's `POSTGRES_POOL_OPTIONS.idleTimeoutMillis`, raised to
60 s in the integration merge. W1's 30 s would already stop the 10 s-poll churn; 60 s also keeps
30 s pollers warm.

### Other measurements

| Measure                               | Base                          | Final                                          | Source                    |
| ------------------------------------- | ----------------------------- | ---------------------------------------------- | ------------------------- |
| Service worker precache, console      | 88 entries, 978 KB gzip       | 91 entries, 956 KB gzip                        | `summary.json` `precache` |
| Service worker precache, ops          | 37 entries, 494 KB gzip       | 41 entries, 486 KB gzip                        | same                      |
| Where the worker installs             | every console and ops page    | console `/app/**`, `/print/**`, every ops page | `app-shell.spec.ts`       |
| Guest menu JSON as served (318 items) | 192,426 bytes, not compressed | 192,430 bytes, not compressed                  | `summary.json` `payloads` |
| Same, if gzip were applied            | 29,452 bytes                  | 29,400 bytes                                   | same                      |
| API standalone output (forced builds) | 81.4 MB                       | 85.2 MB                                        | `coldStart`               |

The API output grew only because other workstreams' code was merged. An earlier "+5.8 MB" figure
compared a Turbo cache replay with a real build; forced builds removed that artefact.

## What W6 changed

| Change                                                                                                                                                                                                                                       | Evidence                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The offline layer runs only where offline matters. `StaffOffline` registers the service worker and starts the offline runtime from console `/app` and `/print` layouts and the ops root layout. It is a static import with no lazy boundary. | Public and guest pages install no worker and load no runtime (E2E). Waiter first data 348 → 108 ms. |
| A change made before the runtime knows the signed-in user waits up to 5 s for it. The kitchen card shows "Connecting…" until then.                                                                                                           | Unit tests (`runtime.test.ts`, `ticket-card.test.tsx`)                                              |
| Kitchen taps without IndexedDB: online they are sent directly (versioned, idempotent, one at a time, nothing drawn as done before a 2xx). Offline the card says changes can't be saved in this browser.                                      | `ticket-card.test.tsx`                                                                              |
| Query results that resolved before persistence started (or before the session user was confirmed) are written to IndexedDB.                                                                                                                  | `persist-queries.test.ts`; offline reload E2E                                                       |
| The connectivity ping releases its response body (it held the request open until its 5 s timer).                                                                                                                                             | `runtime.test.ts`                                                                                   |
| Geist Mono is no longer preloaded (70 KB font, used only for codes).                                                                                                                                                                         | The font is requested on no measured page                                                           |
| The plans parser uses zod/mini.                                                                                                                                                                                                              | −7.6 KB on pricing; parity tests                                                                    |
| Guest page: item and cart sheets load from an effect once the menu is shown; the orders and bill tabs are lazy with a loading state; "Loading…" shows if a sheet is opened early.                                                            | −20.4 KB; guest E2E                                                                                 |
| Recharts plots are lazy inside pre-sized boxes. A failed chunk shows "Chart unavailable" in place.                                                                                                                                           | −105 to −112 KB; `charts.test.tsx`                                                                  |
| Realtime events refetch once per 250 ms burst.                                                                                                                                                                                               | `use-branch-events.test.tsx`                                                                        |
| Migration 0009: `bills_branch_open_idx`. The query writes the `'ISSUED'` literal, so generic plans match it too.                                                                                                                             | 0.583 → 0.022 ms                                                                                    |
| Migration 0010: the kitchen query uses CASE instead of coalesce (identical result), plus two indexes.                                                                                                                                        | 2.11 → 0.105 ms; `kitchen-recent-plan.test.ts` (RLS, PGlite)                                        |
| Compose: Caddy compresses JSON, HTML, JS, CSS and SVG (zstd, gzip), never event streams.                                                                                                                                                     | `infra/compose/Caddyfile`; not run here (no Docker daemon or caddy binary)                          |
| Harness and probes (`scripts/perf/`, `.claude/audit/W6-raw/*.mjs`).                                                                                                                                                                          | This report                                                                                         |

## Corrections to the first version of this report

- That version ran Lighthouse with the service worker active. When the worker took control, its
  requests counted as free in Lantern's simulation, so the guest (4815 → 3474 ms) and pricing gains
  were overstated. The worker is now blocked in every run.
- The lazily loaded offline runtime (a `next/dynamic` boundary in the root layout) delayed the
  first API request on every console and ops page by about 250 ms, which simulated metrics cannot
  show. It is replaced by `StaffOffline`, and the first-request time is now part of every run.
- The API latency "wins" in that version were single series on a busy machine. Only the
  endpoints whose plans changed are claimed now.
- zod/mini saves about 7.6 KB, not the 42 KB pricing change, most of which was the offline
  runtime. Of the guest page's −54.8 KB, 34.4 KB was the offline runtime.
- The 5.8 MB API output growth was a Turbo cache replay, not code.

## Open items

1. **The GA4 tracking client ships full zod to every page** (medium; W5). The root layout's
   tracking client imports `validateTrackingEvent` from `@ros/contracts/tracking-events`, which
   is built on zod and pulls in more contract schemas: two chunks of 22.8 and 11.5 KB gzip on
   every console page, the guest page and marketing pages included. Options: write the tracking
   catalog with `zod/mini` (as the plans parser now is, checked by parity tests), validate in
   development and on the server only, or load the tracking client after consent.
2. **API JSON is not compressed by Next.js** (medium). The guest menu is 192,430 bytes as served
   and 29,400 bytes as gzip. `next start` does not compress route-handler responses and drops a
   `content-encoding` set by a handler, so the frontend proxy cannot compress (tried, reverted).
   - Compose: Caddy now compresses.
   - Cloud Run: first check whether Google's front end already compresses, with one read-only
     request (owner action, not a load test): `curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' <staging console>/api/v1/public/plans | grep -i content-encoding`.
   - If it does not, put a small zero-dependency `node:http` + `node:zlib` front in the frontend
     image (gzip `application/json` of 1 KB or more, never `text/event-stream`, `Vary:
Accept-Encoding`), or a Caddy sidecar. Both cost nothing and need no new cloud resource.
   - Server-rendering the guest menu into the HTML (as W4 did for plans) was not done here. The
     public QR endpoint rate-limits by client IP, so a server-side fetch would need W1's signed
     client-IP header. The guest's client query also saves the menu for offline use. The work is
     contained, but it touches the security proxy.
3. **The service worker's precache is still about 1 MB** (low now). It installs only on staff
   routes, but there it precaches every chunk of the app, marketing and guest chunks included.
   Filtering the precache list per app would trim it.
4. **Owner dashboard CLS 0.117** (low to medium; W3). The Branches section is pushed down by
   content that appears after first paint. It is unchanged by W6.
5. **Analytics over long ranges** (low). Workspace analytics for 90 days takes 130–136 ms at c1
   on Postgres here. If workspaces grow to many branches or years of data, pre-aggregate daily
   totals.
6. **Occasional late first request on sign-in and guest** (low). Two of three Lighthouse runs
   start the first API request about 300 ms after load. Plain Chromium shows the same rate on the
   base build (1–2 of 20). The likely cause is the PPR shell's Suspense boundary hydrating its
   streamed content after a fallback commit. A React profile of a slow load would confirm it.

## Deploying migrations 0009 and 0010

- Both are additive (`CREATE INDEX IF NOT EXISTS`) and have down files that only drop their
  indexes (no data change).
- Drizzle applies all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` is not
  possible through the migrate job. Each index build blocks writes to its table (`bills`,
  `orders`) until the transaction commits. At current sizes that takes well under a second; once
  `orders` holds millions of rows, deploy at a quiet hour.
- Drizzle applies a migration only if its journal timestamp is newer than the last applied one.
  0009 and 0010 come after the analytics workstream's 0008, so deploy them together with it or
  after it.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm perf --label final --out .data/perf-results/final \
  --compare .data/perf-results/baseline/summary.json
```

This needs Chrome for Testing (installed with Playwright) and, for the `pg` phase, a local
PostgreSQL 18 (`PERF_PG_BIN`, Postgres.app or Homebrew) or Docker. Ports: 4150, 3150–3152 and
55150 (override with `PERF_*_PORT`). A full run takes about 14 minutes here. The comparisons in
this report also used `guest-timing.mjs` (first-request timing in plain Chromium) and
`attribution.mjs` (W6's share of bundle changes) from `.claude/audit/W6-raw/`.
