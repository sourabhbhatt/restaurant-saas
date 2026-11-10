# Performance report

Audit of 2026-11-10 (workstream W6), base commit `97467e8`. Every number below comes from
`pnpm perf` (`scripts/perf/`), run locally on an Apple M4 Pro (12 cores, 24 GB), Node 24.4.1,
with nothing sent to any cloud service.

## Method

`pnpm perf --label <name> [--compare <baseline summary.json>]` runs these phases:

| Phase      | What it measures                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| build      | `pnpm build` of api, console, ops, admin (production)                                                                                                                                                                                        |
| bundles    | First-load JS per route from the build manifests (gzip and raw)                                                                                                                                                                              |
| data       | Fresh PGlite at `.data/perf/pglite`: demo seed plus a synthetic busy restaurant                                                                                                                                                              |
| coldstart  | Standalone `node server.js`: start to healthy, first request, RSS, output size (5 runs)                                                                                                                                                      |
| lighthouse | Lighthouse 13.5.0 against `next start`, 3 runs per page, median                                                                                                                                                                              |
| api        | API latency, p50/p95, at concurrency 1 (100 requests) and 8 (300), after 5 warm-up requests, on PGlite                                                                                                                                       |
| pg         | Same latency on Postgres 18.4 (a throwaway local cluster on 127.0.0.1:55150 with the production roles); statements per request (`pg_stat_statements`), every plan (`auto_explain`, analyze + buffers), connections opened under 10 s polling |

Synthetic dataset (deterministic): 2 branches, 318 menu items with variants and add-ons, 80
tables, 100 days of history at 40 sessions per branch per day (8,104 sessions, 20,224 orders,
60,601 order lines, 7,868 bills, 7,864 payments) and a live service (open sessions, orders in
every status, bill-requested tables).

Lighthouse uses its default mobile profile (simulated slow 4G, mid-range phone CPU) for public,
guest and waiter pages, and the desktop preset for the owner dashboard, kitchen display and
admin. Local Lighthouse numbers are best for comparing before and after; absolute values on a
real phone over a real network will differ.

Guard rails: the harness refuses any database other than its own (`assertPerfDatabase`:
PGlite under `.data/` or 127.0.0.1:55150), checks that each frontend's proxy returns parseable
JSON to a browser-like request before Lighthouse runs, and deletes raw Lighthouse reports after
parsing (the summary keeps the LCP element, layout shifts and request list).

Baseline: the app code of `97467e8` (`apps/`, `packages/`) with the harness. Final: this
branch. Raw output is under `.claude/audit/W6-raw/{baseline,final}/` in the W6 worktree
(git-ignored).

## Results: baseline → final

### Lighthouse (median of 3 runs)

| Page                         | Form    | Perf      | LCP ms      | CLS           | TBT ms  | FCP ms     | Script KB transferred |
| ---------------------------- | ------- | --------- | ----------- | ------------- | ------- | ---------- | --------------------- |
| Landing `/`                  | mobile  | 89 → 89   | 3760 → 3679 | 0 → 0         | 18 → 13 | 1054 → 903 | 357 → 276             |
| Pricing                      | mobile  | 87 → 94   | 4060 → 3073 | 0 → 0         | 8 → 8   | 903 → 903  | 367 → 276             |
| Features                     | mobile  | 90 → 95   | 3683 → 2925 | 0 → 0         | 29 → 9  | 903 → 906  | 290 → 235             |
| Sign-in                      | mobile  | 85 → 88   | 4363 → 3906 | 0.011 → 0.011 | 27 → 27 | 903 → 903  | 345 → 331             |
| Guest QR menu `/t/:token`    | mobile  | 83 → 91   | 4815 → 3474 | 0 → 0         | 45 → 61 | 904 → 902  | 319 → 270             |
| Waiter `/waiter/:id`         | mobile  | 84 → 89   | 4506 → 3760 | 0.002 → 0.002 | 51 → 48 | 904 → 905  | 364 → 375             |
| Owner dashboard `/app/w/:id` | desktop | 96 → 96   | 937 → 854   | 0.115 → 0.115 | 0 → 0   | 244 → 244  | 372 → 384             |
| Kitchen `/kitchen/:id`       | desktop | 100 → 100 | 801 → 747   | 0.001 → 0.001 | 0 → 0   | 246 → 244  | 296 → 306             |
| Admin `/admin`               | desktop | 99 → 99   | 1033 → 1035 | 0 → 0         | 0 → 0   | 245 → 245  | 505 → 507             |

The three runs of one page can differ by about 450 ms of simulated LCP on this machine
(pricing: 3610, 3624 and 4068 ms in one series), so treat smaller changes as noise.

### First-load JS per route (gzip KB)

| App     | Route                                         | Baseline | Final |             Change |
| ------- | --------------------------------------------- | -------: | ----: | -----------------: |
| console | `/`                                           |    271.6 | 229.6 |       −41.9 (−15%) |
| console | `/pricing`                                    |    272.0 | 230.0 |       −42.0 (−15%) |
| console | `/features` (and the other content pages)     |    225.5 | 191.1 |       −34.4 (−15%) |
| console | `/t/[token]` (guest)                          |    303.8 | 249.0 |       −54.8 (−18%) |
| console | `/app/b/[branchId]` (branch overview)         |    464.7 | 355.2 |      −109.6 (−24%) |
| console | `/app/w/[workspaceId]/analytics`              |    473.4 | 363.9 |      −109.5 (−23%) |
| console | `/app/w/[workspaceId]`                        |    353.7 | 358.1 |         +4.4 (+1%) |
| console | `/sign-in`                                    |    303.8 | 308.2 |         +4.4 (+1%) |
| ops     | `/waiter`, `/kitchen`, `/cashier`, `/sign-in` |          |       | +2.1 to +2.5 (+1%) |
| admin   | `/`                                           |    204.4 | 170.2 |       −34.2 (−17%) |
| admin   | `/admin`                                      |    390.5 | 278.6 |      −111.9 (−29%) |
| admin   | other admin routes                            |          |       |         +1.8 (+1%) |

Routes that import the offline modules for their own use (sign-in, the console app shell,
every ops screen) gain 2–4 KB: splitting the offline runtime into its own chunk adds a loader
there without removing anything, and on ops pages about 10 KB more script is transferred in
total. All client chunks together grow 4% (more, smaller chunks); what each page downloads is
the number that matters.

### API latency on Postgres 18 (ms; c1 = one request at a time, c8 = 8 concurrent)

| Endpoint                           | c1 p50        | c1 p95        | c8 p50        | c8 p95        |
| ---------------------------------- | ------------- | ------------- | ------------- | ------------- |
| Guest menu `GET /public/qr/:token` | 11.6 → 10.3   | 13.1 → 12.2   | 61.9 → 41.8   | 122.6 → 48.9  |
| Guest session poll                 | 4.9 → 2.8     | 8.3 → 3.4     | 12.6 → 8.3    | 25.9 → 9.9    |
| Kitchen feed                       | 11.0 → 7.1    | 17.5 → 8.0    | 25.0 → 21.2   | 31.7 → 25.4   |
| Waiter tables                      | 4.3 → 3.0     | 5.1 → 3.6     | 11.6 → 10.0   | 19.7 → 11.9   |
| Waiter active orders               | 5.0 → 3.7     | 6.2 → 4.6     | 14.7 → 13.5   | 17.3 → 16.5   |
| Bill `GET /bills/:id`              | 4.0 → 2.9     | 4.7 → 3.4     | 10.1 → 10.3   | 12.8 → 12.4   |
| Cashier queue                      | 4.7 → 3.7     | 5.5 → 4.1     | 14.9 → 13.7   | 20.8 → 16.4   |
| Workspace analytics, today         | 11.1 → 9.4    | 13.4 → 11.5   | 15.4 → 15.2   | 17.5 → 21.3   |
| Workspace analytics, 30 days       | 64.2 → 61.4   | 68.7 → 93.2   | 72.1 → 69.1   | 79.7 → 74.7   |
| Workspace analytics, 90 days       | 133.6 → 131.0 | 140.8 → 140.2 | 165.2 → 156.0 | 231.9 → 227.4 |
| Guest order `POST`                 | 11.6 → 11.4   | 16.3 → 16.4   |               |               |
| Staff order `POST` (c4)            | 11.6 → 11.5   | 12.3 → 12.6   | 25.7 → 25.3   | 28.5 → 27.8   |

Connections opened by the API for six kitchen-feed polls 11 s apart: **12 → 0**.

Open-bills query (cashier queue and bill page): sequential scan of `bills` with 7,866 rows
filtered, 0.89 ms → index scan on `bills_branch_open_idx`, 0.02 ms. Statements per request are
unchanged (8–16; reads use one transaction).

The final run still had two `orders` indexes in migration 0009 that the planner never chose;
they were removed afterwards (see open item 2), which does not change these numbers.

PGlite latency (the local dev database, one embedded connection) moved the same way; it is in
the raw comparison but is not a production number.

### Cold start (standalone `server.js`, median of 5)

| App     | Start → healthy ms | First request ms | Output MB   |
| ------- | ------------------ | ---------------- | ----------- |
| api     | 269 → 356          | 281 → 164        | 75.9 → 81.7 |
| console | 212 → 226          | 109 → 79         | 49.9 → 49.9 |
| ops     | 224 → 219          | 79 → 78          | 43.0 → 43.2 |
| admin   | 210 → 215          | 77 → 76          | 41.5 → 41.5 |

API start times are bimodal in every run (about 250 or about 360 ms), so the median moving is
not a regression signal. The API standalone output grew by 5.8 MB; no stray files are traced
into it and the cause was not isolated (open item 7). API RSS is about 960 MB on PGlite (the
WASM database) and about 160 MB on Postgres in both runs.

## Changes on this branch

| Change                                                                                               | Why                                                                                                                            | Evidence                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Offline runtime (Dexie, sync engine, query persistence) loads as its own chunk (`app-providers.tsx`) | About 40 KB gzip sat in the root layout of every console and ops page, marketing and guest pages included                      | Landing, pricing, features −34 to −42 KB                        |
| Geist Mono no longer preloaded (`apps/*/src/app/fonts.ts`)                                           | A 70 KB font was preloaded at high priority on every page; it is only used for reference codes, branch codes and audit details | The font is no longer requested on these pages                  |
| Public plans parsed with `zod/mini` (`site/pricing/plans.ts`)                                        | Full zod (31 KB gzip) shipped to the marketing pages for one tolerant parser; same schema, same tests                          | Pricing −42 KB                                                  |
| Guest page: item sheet, cart sheet, orders and bill tabs lazy, prefetched once the menu renders      | Only the menu is on screen after a scan; the sheets pulled in form controls and zod                                            | Guest −55 KB, LCP 4815 → 3474 ms                                |
| Recharts plots lazy inside pre-sized boxes (`analytics/charts.tsx`, `charts-recharts.tsx`)           | Recharts (about 115 KB gzip) blocked first paint of branch overview, reports, workspace analytics and admin home               | −110 to −112 KB on those routes; CLS unchanged                  |
| Branch events coalesced into one refetch per 250 ms (`realtime/use-branch-events.ts`)                | Every SSE event cancelled and restarted all branch queries on every screen; a busy service sends bursts                        | Unit test: 4 events → 1 refetch, handlers still get every event |
| Postgres pool keeps idle connections 60 s (`client.ts`)                                              | The default 10 s idle timeout equals the screens' poll interval, so polls reconnected (TLS and SCRAM on Cloud SQL)             | 12 → 0 new connections                                          |
| Partial index `bills_branch_open_idx` (migration 0009, with down file)                               | The cashier queue and bill page scanned every bill of the branch on each poll                                                  | 0.89 → 0.02 ms                                                  |
| Harness (`scripts/perf/`)                                                                            | Repeatable local measurement, database guard, JSON sanity check, diagnostics                                                   | This report                                                     |

Reverted during the audit: gzip in the frontend API proxy. `next start` drops the
`content-encoding` header from route-handler responses, so browsers received raw gzip as JSON
and every proxied call failed. The harness caught it; the unit test, which only inspected the
`Response` object, did not.

## Open items

1. **Proxied JSON is not compressed** (medium). The guest menu response is 188.6 KB on the wire
   for 318 items (about 29 KB as gzip), and the API does not compress either. Next.js does not
   compress route-handler responses and drops a `content-encoding` set by the handler. Options:
   compression at a proxy or CDN in front of the services, or a smaller menu payload. Measure
   with the harness's guest page.
2. **Kitchen "recently done" query scans `orders`** (medium; grows with history). It runs on
   every kitchen poll (20,199 rows filtered, 2.2 ms here, linear in the branch's order history).
   Indexes on `coalesce(served_at, completed_at, updated_at)` were built and checked: PGlite
   without row-level security used them, Postgres with the production roles did not (a 41-row
   estimate and still a sequential scan). Under row-level security only leakproof clauses can
   become index conditions, and the `coalesce` comparison evidently does not qualify. Fix: a
   stored generated column (for example `finished_at`) with a plain index, or a rewrite with
   plain column comparisons. Both need care (the column add rewrites the table; a rewrite must
   keep the exact semantics).
3. **The service worker precaches every client chunk for every visitor** (medium). Console:
   88 entries, about 978 KB gzip; ops: 37 entries, about 494 KB gzip. They download after `load`
   on the first visit, including marketing visitors and guests on mobile data. Options: register
   the worker only where offline matters (staff routes and `/t/`), or precache only the routes
   each audience uses. Owner: offline (W2), with product input.
4. **Connectivity probe holds its connection for 5 s** (low). `probeConnectivity` in
   `offline/runtime.ts` never reads or cancels the `/api/v1/sync/ping` body, so the request
   stays open until its 5 s abort timer. Chromium reports `ERR_ABORTED` at about 5.3 s although
   the response arrived in 6–57 ms (Playwright check, with and without the service worker).
   Fix: `void res.body?.cancel().catch(() => {})` after the status check. Owner: offline (W2).
5. **Owner dashboard CLS 0.115** (low to medium). The Branches section is pushed down twice
   (shift scores 0.098 and 0.017) by content above it that appears after first paint, most
   likely the setup checklist and the plan-limits line, which render once their queries
   resolve. Reserve their space or place them below the branches. Owner: UX (W3).
6. **Analytics over long ranges** (low for now). Workspace analytics for 90 days takes 131 ms
   at c1 on Postgres; the top-items aggregation dominates (59 ms for 30 days). Fine at this
   size; pre-aggregate daily totals if workspaces reach many branches or years of data.
7. **API standalone output +5.8 MB** between baseline and final with no new dependency in the
   API; not isolated. Compare the two standalone trees before shipping images.

## Deploying migration 0009

- Additive (`CREATE INDEX IF NOT EXISTS`), with `migrations-down/0009_perf_indexes.down.sql`.
- Drizzle applies all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY`
  cannot run through the migrate job. A plain `CREATE INDEX` blocks writes to `bills` while it
  builds; the index holds only `ISSUED` bills, but the build still reads the whole table, so run
  the deploy at a quiet hour once `bills` is large.
- It is numbered after the analytics workstream's 0008. Drizzle applies a migration only if its
  journal timestamp is newer than the newest applied one, so do not deploy this branch to a
  shared database before that 0008: 0008 would then be skipped.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm perf --label final --out .data/perf-results/final \
  --compare .data/perf-results/baseline/summary.json
```

Needs Chrome for Testing (installed with Playwright) and, for the `pg` phase, a local
PostgreSQL 18 (`PERF_PG_BIN`, Postgres.app or Homebrew) or Docker. Ports: 4150, 3150–3152 and
55150 (override with `PERF_*_PORT`). A full run took about 15 minutes here.
