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
throwaway PGlite database under `.data/e2e-<api port>` with the demo seed and serves the API
(`NODE_ENV=test`, test hooks on, never `.env.local` or a Postgres server), then starts console,
ops and admin as production builds proxying `/api/v1` to it. Ports: console 3100, ops 3101,
admin 3102, API 4100 (`E2E_PORT`, `E2E_OPS_PORT`, `E2E_ADMIN_PORT`, `E2E_API_PORT`). With
`E2E_BASE_URL` (+ `E2E_OPS_URL`, `E2E_ADMIN_URL`) it tests running servers instead.

- Global setup signs each demo account in once and saves its cookies under `.data/e2e-auth`
  (sign-in is rate limited); a saved session the server still accepts is reused.
- Every API and browser context gets its own `X-Forwarded-For` address, so the per-IP rate
  limits never couple parallel tests.
- Tests never share a table: `freshTable()` creates one (with its QR code) per test, so a repeat
  or a CI retry never meets an earlier attempt's session or bill. Orders are found by a unique
  note.
- Animations are off (`reducedMotion: "reduce"`; the UI kit only animates `motion-safe`) and the
  test timeout is 60 s, so slow shared runners do not cause flakes.
- `page.route()` does not see requests the service worker makes (GET `/api/*` once it controls
  the page): a test that stubs API reads opens its context with `serviceWorkers: "block"`.

| Spec                       | Project | Covers                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site.spec.ts`             | both    | public pages, sign-up validation, sign-in error, reset without token                                                                                                                                                                                                                              |
| `app-shell.spec.ts`        | both    | home page, web app manifest, service worker, offline fallback page                                                                                                                                                                                                                                |
| `owner-onboarding.spec.ts` | desktop | sign-up form, onboarding wizard (workspace, restaurant and branch, first dish, tables), QR codes generated on the print sheet, a guest opens the first QR menu                                                                                                                                    |
| `guest.spec.ts`            | mobile  | QR menu, search, customisation, order and re-order, two guests on one bill, bill request, invalid/rotated QR, lost session cookie, offline and lost-response retries                                                                                                                              |
| `waiter.spec.ts`           | mobile  | approve and serve a QR order, reject with a reason (guest sees it), staff-entered order, bill requests                                                                                                                                                                                            |
| `operations.spec.ts`       | desktop | kitchen start and item-level ready, cashier bill with split UPI + cash payment and change, two waiters racing on one order (409), dashboard history/tables/bills, ops back links                                                                                                                  |
| `offline.spec.ts`          | desktop | staff order queued offline and sent once, kitchen updates queued, reloaded offline and synced, two screens converging, refused change kept as a conflict, session-changed hold and "Retry with latest", lost answer + 503 replayed with one idempotency key, online-only actions disabled offline |

## Smoke run

`pnpm smoke --base-url <console URL>` signs in as the demo owner (or `SMOKE_EMAIL` / `SMOKE_PASSWORD`) and runs QR → guest join → order → accept → bill → payment → bill PAID over public HTTP only. Use it after every deploy and every restore.

## Not covered yet

- Browser end-to-end journeys for staff invitations, the super-admin console and subscription upgrades (covered by API integration tests only).
- Docker images and the compose stack are not exercised by tests (CI builds the affected images only).
- Load and accessibility audits.

Quality gate before merging: `pnpm check` (typecheck, lint, format, all tests) and `pnpm build`.
