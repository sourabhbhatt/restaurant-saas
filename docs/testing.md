# Testing

`pnpm test` runs `turbo run test`, which runs Vitest in every app and package that has tests (only the affected ones in CI). Each package's `vitest.config.mts` builds on `serverProject` / `uiProject` from `packages/tooling/vitest.base.mts`. The root `vitest.config.mts` lists every package as a project, so one file can be run from the root with `pnpm exec vitest run <path>`, or inside a package with `pnpm --filter <package> exec vitest run <path>`.

| Package / app          | Environment                  | Test files | Covers                                                                                                |
| ---------------------- | ---------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `packages/domain`      | node                         | 14         | pricing, order state machine, bill calculator, payments, entitlements, workspace limits, permissions  |
| `packages/application` | node                         | 4          | env schema, request DB context, client IP parsing, tenancy rules                                      |
| `packages/database`    | node, PGlite                 | 5          | runners, row counts, snapshots, persistent-PGlite migration, migrations directory                     |
| `packages/adapters`    | node                         | 4          | local storage contract, S3 contract (MinIO, opt-in), Postgres realtime bus (opt-in), payments adapter |
| `packages/ui`          | jsdom                        | 8          | design-system components                                                                              |
| `packages/web-core`    | node + jsdom, fake-indexeddb | 11         | API proxy, security headers, offline sync engine and queues, notification bell, site pages            |
| `apps/ops`             | jsdom                        | 1          | waiter table drawer                                                                                   |
| `apps/api`             | node, PGlite                 | 32         | API integration suites (`tests/integration/`, 30) and container wiring (`src/composition`, 2)         |

Plus `pnpm test:codemod` (node:test, the import codemod), the Playwright specs in `tests/e2e/`, and two HTTP-only scripts against a running API: `pnpm smoke` (order to bill) and `pnpm razorpay:test-e2e` (Razorpay test-mode checkout and signed webhooks; see [deployment](deployment.md#test-mode-checks)).

**Integration tests** (`apps/api/tests/integration`) call the real route handlers against an embedded PostgreSQL 18 (PGlite) with every migration applied (`apps/api/src/test/harness.ts`: `createTestContainer`, `call`, `cookieFrom`). Nothing in the business path is mocked. They run with the tenant role switch on, so row-level security applies to every tenant query. Fixtures: `apps/api/src/test/fixtures*.ts`. The harness passes `undefined` params to static routes exactly like Next.js, and sets `TRUSTED_PROXY_HOPS=1` so each fixture user gets its own client IP.

What the integration suites attack: cross-workspace and cross-branch access (404) in `security-tenant-isolation`, every route × role in `security-rbac-matrix`, subscription phases in `security-subscription-enforcement`, row-level security and the tenant table list in `security-rls`, the system runner allow-list in `security-runner-allowlist`, CSRF origin blocking, stale-version conflicts, concurrent order acceptance (one wins), idempotent replays (orders, payments, bills), QR revocation, guest visibility, workspace limits and fair use, organization billing, the 0003/0004 data migrations (`migration-*.test.ts`), Razorpay checkout/verify/webhook with a fake gateway, and dump → restore → verify round trips (`db-tools`).

## Suites that need real services (opt-in locally, always in CI)

| Suite                                                                                          | Needs                                                                                                                  | CI job           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `apps/api/tests/integration/db-restore-postgres.test.ts` (restore as a different user, grants) | `PG_TEST_URL` = superuser URL of a throwaway Postgres 18; `pg_dump`/`pg_restore` 18 on `PATH` or `PG_DOCKER_CONTAINER` | `integration-pg` |
| `apps/api/tests/integration/security-rls.test.ts` on Postgres 18                               | runs on PGlite everywhere; CI runs it again next to a Postgres 18 service                                              | `integration-pg` |
| `packages/adapters/src/realtime/providers/postgres-bus.test.ts`                                | `PG_TEST_URL`                                                                                                          | `integration-pg` |
| `packages/adapters/src/storage/providers/s3-storage.test.ts`                                   | MinIO and `S3_TEST_ENDPOINT` (+ `S3_TEST_BUCKET`, `S3_TEST_ACCESS_KEY`, `S3_TEST_SECRET_KEY`)                          | `storage-s3`     |

Local Postgres for them: `docker run -d --name ros-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:18`, then `PG_TEST_URL=postgres://postgres:dev@localhost:55432/postgres PG_DOCKER_CONTAINER=ros-pg pnpm --filter @ros/api exec vitest run tests/integration/db-restore-postgres.test.ts`.

## Browser tests

`pnpm exec playwright install chromium && pnpm test:e2e`. Without `E2E_BASE_URL`, Playwright
runs `tests/e2e/support/serve-api.ts`, which builds the four apps (turbo cache), recreates a
throwaway PGlite database under `.data/e2e-<api port>` with the demo seed and serves the API,
then starts console, ops and admin as production builds proxying `/api/v1` to it. Ports:
console 3100, ops 3101, admin 3102, API 4100 (`E2E_PORT`, `E2E_OPS_PORT`, `E2E_ADMIN_PORT`,
`E2E_API_PORT`). Never pick a port on the Fetch standard's "bad ports" list (for example 4190):
Node's `fetch` refuses to connect to it, so the frontends' proxy cannot reach an API there.

`E2E_SKIP_BUILD=1` makes serve-api skip the build and serve the existing production builds. CI uses it for a second run, `tests/e2e/analytics-consent.spec.ts` with `GA_MEASUREMENT_ID=G-E2ETEST01` (every Google request is answered inside the browser, nothing is sent), which writes its report to `playwright-report-consent/` and `test-results-consent/`; see [growth analytics](growth/analytics-events.md#tests).

- The API is a production build with a test runtime configuration: `NODE_ENV=test` (fast
  password hashing, no production env checks) and `ENABLE_TEST_HOOKS=true` (the dev mailbox the
  invitation journey reads). Its environment is exactly the one serve-api builds:
  `ROS_NO_ENV_FILE=1` stops `apps/api/next.config.ts` from loading the repo-root `.env.local`,
  server settings from the shell are dropped, and email (outbox), storage (throwaway dir),
  push, payments, analytics (`TRACKING_PROVIDER=none`), `QR_BASE_URL` and the database (PGlite
  only, never `DATABASE_URL`) are pinned. A developer's local providers never see E2E traffic.
- **Writes are guarded.** The suite creates tables, orders, payments, owners and workspaces.
  serve-api sets `APP_VERSION=e2e-<random>` and records it in `.data/e2e-<api port>/run-id`;
  global setup refuses to run unless the API, console, ops and admin `/api/v1/health` all report
  that id. So a server reused on an E2E port that is not this throwaway stack (or a console
  proxying to another API) is refused before anything is written. No variable turns this off
  for local runs.
- `E2E_BASE_URL` (+ `E2E_OPS_URL`, `E2E_ADMIN_URL`) tests running servers instead. **That writes
  to their database**: use only a disposable, demo-seeded stack, and confirm with
  `E2E_ALLOW_WRITES=<that console origin>` (e.g. `E2E_ALLOW_WRITES=http://localhost:3000`; any
  other value, including a stale `1`, is refused). Never point it at staging or production. The
  invitation journey reads the email outbox on the local API (`E2E_API_PORT`), so it needs the
  local E2E stack.

- Global setup signs each demo account in once and saves its cookies under
  `.data/e2e-auth/<console host>` (sign-in is rate limited; one folder per target because
  localhost cookies ignore the port); a saved session the server still accepts is reused.
- Specs that change subscription, workspace or membership state (`admin`, `subscription`,
  `owner-invitations`) work on a brand-new owner (`newOwner()`), never on the demo workspace.
- Every API and browser context gets its own `X-Forwarded-For` address, so the per-IP rate
  limits never couple parallel tests.
- Tests never share a table: `freshTable()` creates one (with its QR code) per test, so a repeat
  or a CI retry never meets an earlier attempt's session or bill. Orders are found by a unique
  note.
- Animations are off (`reducedMotion: "reduce"`; the UI kit only animates `motion-safe`) and the
  test timeout is 60 s, so slow shared runners do not cause flakes.
- `page.route()` does not see requests the service worker makes (GET `/api/*` once it controls
  the page): a test that stubs API reads opens its context with `serviceWorkers: "block"`.

| Spec                        | Project    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site.spec.ts`              | both       | public pages, sign-up validation, sign-in error, reset without token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `app-shell.spec.ts`         | both       | home page, web app manifest, service worker, offline fallback page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `owner-invitations.spec.ts` | desktop    | a new owner invites a cook (Kitchen Staff, one branch); the link from the email outbox (dev mailbox) matches the one shown; the cook signs up, accepts, signs in on ops and gets the kitchen screen; the waiter console and the orders/invitations APIs refuse the role                                                                                                                                                                                                                                                                                             |
| `admin.spec.ts`             | desktop    | super admin signs in on the admin app; workspace search and detail (plan, members); trial extension; organization workspace-limit override (402 before, 201 after); suspend (owner refused) and reactivate; audit log rows for each action; a workspace owner is refused by the admin app and `/api/v1/admin/*`; a duplicate plan key is a 422 field error, not a 500 (unique index across bundle copies, production build)                                                                                                                                         |
| `subscription.spec.ts`      | desktop    | trial banner with the server's days left; the restaurant limit disables "Create restaurant" with the reason as its description; upgrade request without a payment gateway; super-admin approval in the admin app; Enterprise limits apply and the banner is gone after a reload                                                                                                                                                                                                                                                                                     |
| `owner-onboarding.spec.ts`  | desktop    | sign-up form, onboarding wizard (workspace, restaurant and branch, first dish, tables with their QR codes created during setup), hand-over to the dashboard's first-order checklist, print sheet with every code, a guest opens the first QR menu                                                                                                                                                                                                                                                                                                                   |
| `guest.spec.ts`             | mobile     | QR menu, search, customisation, order and re-order, two guests on one bill, bill request, invalid/rotated QR, lost session cookie, offline and lost-response retries                                                                                                                                                                                                                                                                                                                                                                                                |
| `waiter.spec.ts`            | mobile     | approve and serve a QR order, reject with a reason (guest sees it), staff-entered order, bill requests                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `operations.spec.ts`        | desktop    | kitchen start and item-level ready, cashier bill with split UPI + cash payment and change, two waiters racing on one order (409), dashboard history/tables/bills, ops back links                                                                                                                                                                                                                                                                                                                                                                                    |
| `offline.spec.ts`           | desktop    | staff order queued offline and sent once, kitchen updates queued, reloaded offline and synced, two screens converging, refused change kept as a conflict, session-changed hold and "Retry with latest", lost answer + 503 replayed with one idempotency key, online-only actions disabled offline                                                                                                                                                                                                                                                                   |
| `accessibility.spec.ts`     | per screen | axe-core via `@axe-core/playwright`, WCAG 2.0/2.1 A and AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`), no rules disabled, zero violations: landing, pricing and sign-in (both projects); workspace and branch overview, menu editor, tables, QR print sheet, kitchen, cashier and Super Admin home (desktop); guest QR menu and waiter console (mobile). Each scan waits for the screen's real content, never a skeleton                                                                                                                                          |
| `seo.spec.ts`               | both       | public pages server-rendered for crawlers (title, description, canonical, robots, h1 and JSON-LD in the initial HTML), pricing in the HTML matches the structured-data offers, AI crawlers get the same metadata, metadata after streaming, heading levels never skip, feature pages linked, private routes noindex (app redirect, API proxy, icons). The expected origin comes from the runner's `PUBLIC_SITE_URL`/`CONSOLE_URL`: export `CONSOLE_URL` when using non-default ports. The indexable case runs only with `SITE_INDEXABLE=true` and `PUBLIC_SITE_URL` |
| `analytics-consent.spec.ts` | both       | without a Measurement ID: no banner, tag or Google request on any page. With one (the second CI run above): nothing reaches Google before a choice, declining persists across navigations and reloads, allowing loads gtag.js once with one page_view per navigation, sign-up events carry no personal data, guest QR pages never load the tag, the footer link reopens the choice and a withdrawal removes GA cookies and stops other tabs, auth pages offer Cookie settings                                                                                       |

## Smoke run

`pnpm smoke --base-url <console URL>` signs in as the demo owner (or `SMOKE_EMAIL` / `SMOKE_PASSWORD`) and runs QR → guest join → order → accept → bill → payment → bill PAID over public HTTP only. Use it after every deploy and every restore.

## Not covered yet

- Online (Razorpay test-mode) checkout in the browser: `PAYMENT_PROVIDER=none` in E2E; covered by API integration tests and `scripts/razorpay-test-e2e.ts` (manual, Razorpay test mode).
- Docker images and the compose stack are not exercised by tests (CI builds the affected images only).
- Load tests (see `docs/audits/performance-report.md`).
- Accessibility beyond automated rules: axe finds roughly a third of WCAG issues. Keyboard-only use, screen readers (TalkBack, VoiceOver), 200% zoom and reduced motion are checked by hand before releases.

Quality gate before merging: `pnpm check` (typecheck, lint, format, all tests) and `pnpm build`.
