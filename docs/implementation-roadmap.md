# Implementation Roadmap — status

Last updated: 2026-11-07, after Phase 5 (clean-up and documentation) of the plan in `docs/superpowers/plans/2026-11-07-phases-0-5-security-tenancy-subscriptions-portability-monorepo.md`, against the design in `docs/superpowers/specs/2026-11-07-platform-split-and-gcp-design.md`.

Phases 4 and 5 were finished with static checks only (`pnpm turbo run typecheck lint`, `pnpm format:check`, one `next build` per app in Phase 4). Vitest, Playwright and the Docker images were not run after the monorepo split, at the owner's request; the owner verifies them manually (see "To verify" below).

## Done

### Product (before 2026-11-07)

- [x] Schema, migrations and `ensureSystemData` (permissions, system roles, default plans/settings)
- [x] Domain rules with unit tests: pricing, order state machine, bill calculator, payment ledger, entitlements and trial lifecycle, permissions
- [x] Auth, workspaces, tenancy (restaurants, branches, members, invitations, roles), menu, tables and QR, customer QR ordering, waiter / kitchen / cashier consoles, billing, notifications, analytics, Super Admin, support, upgrade requests, audit
- [x] Offline layer: Dexie cache, sync outbox engine, service worker rules, `/~offline` (see `offline-sync.md`)
- [x] Public site and legal templates; `pnpm db:seed` and `pnpm db:make-admin`

### Phase 0 — local data safety and security fixes

- [x] `pnpm db:snapshot`; a persistent PGlite directory is never auto-migrated; `db:migrate` snapshots it first
- [x] Exposed cookie-jar sessions revoked (`pnpm db:revoke-cookie-jar`), `*.jar` / `*.cookies` ignored
- [x] `TRUSTED_PROXY_HOPS` (client IP parsing), `ALLOWED_ORIGINS` (CSRF origin list), idempotency replay by the same user only, security headers, CI with secret scanning and `pnpm audit`

### Phase 1 — tenant isolation in the database

- [x] Request DB context, tenant runner (`SET LOCAL ROLE ros_tenant` + `app.workspace_id` / `app.user_id`), system runner allow-list test
- [x] Migration `0002_tenant_rls`: roles, grants, policies on every tenant table, down script
- [x] RBAC matrix, tenant isolation and subscription enforcement suites

### Phase 2 — organizations, trials and workspace limits

- [x] Migration `0003_organizations` (expand + backfill; `subscriptions.workspace_id` kept and dual-written)
- [x] Migration `0004_trial_and_workspace_limits`: 15-day trial, 7-day grace, reminders on days 7/12/14 (only where settings were still the old defaults); Pro 3 workspaces on ANNUAL, Enterprise unlimited within fair use (25, 5 creates per day); Super Admin per-organization override
- [x] Feature flags enforced on the server (`feature-enforcement` suite)
- [x] Razorpay prepaid payments (Orders + Standard Checkout, webhook) with migration `0005_payments`

### Phase 3 — provider portability

- [x] S3-compatible storage adapter with a shared contract suite (MinIO in CI)
- [x] Postgres `LISTEN/NOTIFY` realtime bus
- [x] `db:dump` / `db:restore` / `db:verify`, restore as a different user, `pnpm smoke`; rehearsal of the local data on Postgres 18 (Task 25)
- [x] Health and readiness endpoints, `APP_VERSION`, maintenance mode

### Phase 4 — monorepo and independent deployability

- [x] pnpm workspaces + Turborepo; packages `domain`, `contracts`, `application`, `adapters`, `database`, `api-client`, `ui`, `web-core`, `testing`, `tooling`
- [x] `apps/api` (:4000), `apps/console` (:3000), `apps/ops` (:3001), `apps/admin` (:3002); runtime `/api/v1` proxy in each frontend; per-app sign-in
- [x] One Dockerfile for per-app images, compose stack (Postgres 18, MinIO, migrate and roles one-shots, the four apps)
- [x] CI: affected-only `typecheck lint test build`, Postgres 18 and MinIO jobs, per-app image builds

### Phase 5 — clean-up and documentation

- [x] Comments that restate code removed (comment lines 3,344 → 3,320; contracts, reasons and security rationale kept)
- [x] Unused files, exports and dependencies removed; duplicated route error, global error, proxy, offline page and Serwist route code shared through `@ros/web-core`; tracked `node_modules` symlinks removed from git
- [x] Instant-navigation validation error on client-gated layouts resolved (`instant = false` with the reason)
- [x] Docs for the monorepo, the RLS model, every env var, compose and Cloud Run notes; runbooks in `docs/runbooks/`

## To verify (owner, manually)

1. `pnpm test` across the workspace, `pnpm test:codemod`, `pnpm test:e2e`.
2. `pnpm dev`: sign in on the console, open a branch; Waiter/Kitchen/Cashier links open `http://localhost:3001/...` and ask for a second sign-in; the Super Admin link opens `http://localhost:3002/admin`. Confirm the "instant navigation" dev error is gone on `/app/w/<id>/analytics`.
3. `docker build` for the four apps and `docker compose … up -d`; then `pnpm smoke --base-url http://localhost:3000`.
4. Applying migrations `0002`–`0005` to the real `.data/pglite` (Task 34 Step 3, controller with owner approval), per [local data preservation](runbooks/local-data-preservation.md).

## Not done

- Cloud provisioning scripts (`infra/gcp/`), Cloud SQL, Cloud Run deploys (owner approval gates; nothing paid is active)
- Web Push adapter (plumbing and service worker handlers exist; `PUSH_PROVIDER=none` only)
- Error monitoring adapter (Sentry)
- Browser end-to-end workflows A–I (only three Playwright specs exist)
- Contract step of the organization migration (`NOT NULL` on `organization_id`, dropping `subscriptions.workspace_id`): approval gate, not scheduled
- Load test, accessibility audit, legal review of the templates
