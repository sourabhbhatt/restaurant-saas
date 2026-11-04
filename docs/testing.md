# Testing

`pnpm test` runs two Vitest projects (config: `vitest.config.mts`):

| Project  | Environment            | Files                                                                               | Covers                                                                       |
| -------- | ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ui`     | jsdom + fake-indexeddb | `src/{components,features,lib,app}/**/*.test.tsx?`                                  | design-system components, offline sync engine, notification bell, site pages |
| `server` | node                   | `src/{domain,server,infrastructure,contracts}/**/*.test.ts`, `tests/integration/**` | pure rules and API integration                                               |

**Integration tests** call the real route handlers against an embedded PostgreSQL (PGlite) with all migrations applied (`src/test/harness.ts`: `createTestContainer`, `call`, `cookieFrom`). Nothing in the business path is mocked. Fixtures: `src/test/fixtures*.ts`. The harness passes `undefined` params to static routes exactly like Next.js.

What the integration suites attack: cross-workspace and cross-branch access (404), role restrictions (waiter, kitchen, cashier, manager), CSRF origin blocking, stale-version conflicts, concurrent order acceptance (one wins), idempotent replays (orders, payments, bills), overpayment and disabled payment methods, QR revocation, guest visibility, subscription phases with an advanced clock, entitlement limits, notification isolation.

## Also verified manually (live server, HTTP only)

QR scan → session → order → waiter accept → kitchen start/ready → serve → bill with tax → two partial payments → PAID → replayed payment key → session closed, plus role denials. This run is not an automated test.

## Not covered yet

- **Browser end-to-end workflows** (onboarding, customer ordering, waiter/kitchen, billing, multi-customer, offline reconnect). Only public-site Playwright specs exist (`tests/e2e`). Run with `pnpm exec playwright install chromium && pnpm test:e2e` (it builds and serves on port 3100).
- Service worker behaviour in a real browser (disabled in dev).
- Postgres row-level security (not enabled).
- Load and accessibility audits.

Quality gate before merging: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
