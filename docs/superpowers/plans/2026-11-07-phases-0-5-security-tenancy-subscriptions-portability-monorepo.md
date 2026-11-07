# RestaurantOS Phases 0–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audited security vulnerabilities, add database-enforced tenant isolation and complete RBAC and subscription enforcement (organization billing, workspace limits, 15-day trial), then make the platform provider-independent and split it into four independently deployable apps. All existing functionality and local data are preserved.

**Architecture:** Security first, in place in the current single Next.js app (Phases 0–3), then a mechanical monorepo split (Phase 4) and clean-up (Phase 5).

- Tenant isolation: a request-scoped context plus Postgres row-level security, entered through a tenant transaction runner. Only an allow-listed set of system paths runs without it.
- Billing moves from workspace to organization with expand/backfill/switch migrations. No column is dropped in these phases.
- Every provider stays behind a port selected by environment variables.

**Tech Stack:** Next.js 16.4.5 (App Router, `proxy.ts`), React 19.3, TypeScript 5, Drizzle ORM 0.45 + `pg` 8.23, PGlite 0.5.15 (PostgreSQL 18.6) for tests and local data, Vitest 5, Playwright 1.63, pnpm 10.28, Node ≥ 22. New: Turborepo, `@aws-sdk/client-s3`, `@electric-sql/pglite-tools`.

**Spec:** `docs/superpowers/specs/2026-11-07-platform-split-and-gcp-design.md` (approved 2026-11-07; decisions in §14). Read it before starting any task.

## Global Constraints

- **No cloud resources, deploys, pushes to GitHub, data deletion, or destructive migrations.** Steps marked **[OWNER APPROVAL]** stop and wait for an explicit yes from the owner, even inside an approved plan.
- `.data/pglite` is the owner's data. Never open it for writing, migrate it or delete it, except in Task 34 after approval. Work on copies under `.data/rehearsal/`.
- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md). Next 16 uses `proxy.ts`, not `middleware.ts`.
- Database target: PostgreSQL 18 (local Docker `postgres:18`, CI service `postgres:18`, Cloud SQL 18 later).
- Every task ends with `pnpm check` green (typecheck, lint, format, all tests) and `pnpm build` green. The test count never drops below 368 (baseline at commit `02e5eeb`).
- Migrations are additive in Phases 0–5. Never drop a column, table or constraint. `subscriptions.workspace_id` stays and is dual-written.
- New migrations are generated with `pnpm db:generate` (or `pnpm exec drizzle-kit generate --custom --name <name>` for SQL-only migrations). Every hand-written statement is idempotent (`IF NOT EXISTS`, `WHERE … IS NULL`, `ON CONFLICT DO NOTHING`).
- Business values, copied from the spec:
  - Trial: `trialDays: 15` on plan `pro`; `graceDays: 7`; `trialReminderDays: [7, 12, 14]`.
  - Workspace limits: Starter `maxWorkspaces: 1`; Pro `maxWorkspaces: 3`, effective only on ANNUAL; Enterprise `null` (unlimited, fair use).
  - Fair use: `fairUseMaxWorkspaces: 25`, `workspaceCreatesPerDay: 5`.
  - TRIAL, GRACE or MONTHLY ⇒ at most 1 workspace. A Super Admin per-organization override wins.
- Existing trials keep their `trial_ends_at`. Platform settings change only where the stored value still equals the old default (`trialDays` 30, `trialReminderDays` `[7, 15, 25]`).
- Comments only where they explain a non-obvious reason. Match the surrounding code's naming and idiom.
- Commits: small, one per task (or per step where marked), on branch `claude/epic-turing-vhor3y`. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **A legitimate path silently hidden by RLS.** For example, a user listing their workspaces, a guest joining by QR, an invitation being accepted, or the subscription sweep. Expected: works exactly as before. Pinned by Task 11 Step 4 (the full suite runs with RLS on) and Task 12's route-coverage guard.
2. **Legacy 30-day trials after the defaults change.** Expected: the end date is unchanged, reminder emails state the true days left, and grace starts at the original end. Pinned by Task 17 Step 1 `legacy trial keeps its end date and gets accurate reminder text`.
3. **A legacy owner of several one-workspace organizations creates another workspace.** Expected: a clear choice of organization, and none of the existing workspaces lose access. Pinned by Task 18 Step 1 `legacy multi-org owner must choose organization`.
4. **A request retried across the idempotency-scope change.** Expected: no double payment. The old-format record no longer matches, so the handler's own duplicate guard must hold. Pinned by Task 5 Step 1 `payment retry with pre-change key does not double-charge`.
5. **The local data copy is restored into Postgres 18 and migrated.** Expected: every table's row count matches the snapshot, and the order-to-payment smoke flow passes. Pinned by Task 25 Step 6 (rehearsal) and Task 34.

---

## Phase 0 — Security fixes and baseline

### Task 1: Local data snapshot and safe migration on PGlite (S7)

**Files:**

- Create: `scripts/db-snapshot.ts`, `src/infrastructure/database/providers/postgres/row-counts.ts`, `src/infrastructure/database/providers/postgres/row-counts.test.ts`
- Modify: `.gitignore`, `package.json` (scripts), `src/server/container.ts:181-190` (`getContainer`), `scripts/migrate.ts`, `src/infrastructure/database/providers/postgres/client.ts`

**Interfaces:**

- Produces: `countRows(db: Executor): Promise<Record<string, number>>` (every table in `public`, sorted by name). `pendingMigrations(handle: DatabaseHandle): Promise<string[]>` (journal tags not yet applied). `pnpm db:snapshot`, which writes `.data/snapshots/pglite-<YYYYMMDD-HHmmss>/` plus `manifest.json` `{ createdAt, sourceDir, pgVersion, rowCounts, files: { path: sha256 } }`.

- [ ] **Step 1: Write failing tests** in `row-counts.test.ts`:
  - `countRows returns every public table with exact counts`: in-memory PGlite, migrated, insert 2 users. Expect `counts.users === 2`, `Object.keys(counts)` to include `"workspaces"`, and the keys sorted.
  - `pendingMigrations lists unapplied tags`: fresh handle → `["0000_init", "0001_upgrade_requests"]`; after `runMigrations` → `[]`.
- [ ] **Step 2: Run** `pnpm vitest run src/infrastructure/database/providers/postgres/row-counts.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `countRows` (`information_schema.tables` where `table_schema='public'`, then `count(*)` per table with an identifier-quoted name) and `pendingMigrations` (compare `migrations/meta/_journal.json` tags with `drizzle.__drizzle_migrations`; a missing table means all are pending).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Implement** `scripts/db-snapshot.ts`:
  - Refuse unless `DATABASE_PROVIDER=pglite` and `PGLITE_DATA_DIR` is set.
  - `fs.cp(src, dest, { recursive: true, errorOnExist: true })`.
  - Open **the copy** with `connectPglite(dest)`, write `manifest.json` with the row counts and per-file SHA-256, close it, and print the path and total row count.
  - Add `"db:snapshot": "tsx --env-file=.env.local scripts/db-snapshot.ts"`.
- [ ] **Step 6: Gate auto-migration.**
  - In `getContainer`, migrate on startup only when the PGlite data dir is unset or starts with `memory:`.
  - For a persistent dir with pending migrations, throw `Error("Pending migrations for <dir>: <tags>. Run pnpm db:snapshot then pnpm db:migrate.")`.
  - In `scripts/migrate.ts`, when the provider is pglite with a persistent dir and migrations are pending, run the snapshot routine first and abort if it fails.
- [ ] **Step 7:** Add `/.data/` to `.gitignore`. Run `git status --short`. Expected: `.data/` no longer listed.
- [ ] **Step 8: Take the baseline snapshot.** Stop `pnpm dev` if it is running, then run `pnpm db:snapshot`. This only copies the original. Expected: prints `.data/snapshots/pglite-…`, and `manifest.json` lists every table. Record the total row count in the commit message.
- [ ] **Step 9:** `pnpm check && pnpm build`, then commit `fix(data): snapshot local PGlite data and stop auto-migrating persistent databases`.

### Task 2: Remove tracked session cookies; revoke the exposed sessions (S1)

**Files:**

- Create: `scripts/revoke-cookie-jar.ts`, `src/infrastructure/auth/providers/revoke-cookie-jar.ts`, `src/infrastructure/auth/providers/revoke-cookie-jar.test.ts`, `SECURITY.md`
- Modify: `.gitignore`, `package.json`
- Remove from the index only: `n.jar`, `o.jar`

**Interfaces:**

- Produces: `revokeSessionsFromCookieJar(db: Executor, jarText: string, now: Date): Promise<{ found: number; revoked: number }>`. It parses Netscape cookie-file lines whose name is `ros_session`, hashes each value with `hashToken` from `@/domain/shared/tokens`, and runs `UPDATE sessions SET revoked_at = now WHERE token_hash IN (…) AND revoked_at IS NULL`. It never prints or logs token values.

- [ ] **Step 1: Write failing tests:**
  - `revokes the session named in a jar and resolveSession returns null`: create a user and session through the identity provider, build jar text with that token, expect `{ found: 1, revoked: 1 }`, then `identity.resolveSession(token)` is `null`.
  - `second run revokes nothing`: expect `{ found: 1, revoked: 0 }`.
  - `ignores comment lines and other cookies`.
- [ ] **Step 2: Run** `pnpm vitest run src/infrastructure/auth/providers/revoke-cookie-jar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the function, and the CLI `pnpm db:revoke-cookie-jar <file…>` (reads files and env, prints counts only).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** `git rm --cached n.jar o.jar`. Add `*.jar` and `*.cookies` to `.gitignore`. Leave the files on disk (the owner decides whether to delete them).
- [ ] **Step 6:** Write `SECURITY.md`:
  - What was exposed: two local-dev session tokens on the public repo, branch `claude/epic-turing-vhor3y`, commit `586e3b4`.
  - Reach: valid only against the local PGlite database, never production.
  - Remediation: revoke (Step 7); no history rewrite recommended once revoked, because rewriting a pushed public branch is destructive and the tokens are already dead.
  - How to report a vulnerability.
- [ ] **Step 7: [OWNER APPROVAL] Revoke on the real local data.** This is a non-destructive `UPDATE` of `.data/pglite`, done after Task 1's snapshot. Command: `pnpm db:revoke-cookie-jar n.jar o.jar`. Expected: `found: N, revoked: N`.
- [ ] **Step 8: [OWNER APPROVAL, recommended: decline]** Rewrite git history to purge the files. Skip unless the owner asks.
- [ ] **Step 9:** `pnpm check`, then commit `fix(security): untrack session cookie jars; add revocation tool and SECURITY.md`.

### Task 3: Trusted-proxy client IP (S2)

**Files:**

- Create: `src/server/http/client-ip.ts`, `src/server/http/client-ip.test.ts`
- Modify: `src/server/http/route.ts` (`clientIp`), `src/server/config/env.ts`, `.env.example`

**Interfaces:**

- Produces: `clientIpFrom(headers: Headers, trustedHops: number): string | null`.
  - `trustedHops = 0` ignores `X-Forwarded-For` and `X-Real-IP` and returns `null`.
  - `trustedHops = n` returns the n-th entry **from the right** of the comma-joined `X-Forwarded-For` values, or `null` if there are fewer than n entries.
  - The result must parse as an IPv4/IPv6 literal, otherwise `null`.
- Env: `TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0)`. In production it must be set explicitly; `getEnv` throws `TRUSTED_PROXY_HOPS must be set in production` when absent.

- [ ] **Step 1: Write failing tests:**
  - `hops 1 takes the last entry`: `"6.6.6.6, 203.0.113.9"` → `"203.0.113.9"`.
  - `spoofed leftmost entries are ignored`: `"1.1.1.1, 2.2.2.2, 203.0.113.9"` with hops 1 → `"203.0.113.9"`; with hops 2 → `"2.2.2.2"`.
  - `hops 0 ignores headers` → `null`.
  - `garbage is rejected`: `"not-an-ip"` → `null`.
  - Integration test in `tests/integration/auth-and-workspaces.test.ts` named `sign-in limit cannot be bypassed by rotating X-Forwarded-For`, with `TRUSTED_PROXY_HOPS=1`: 11 failed sign-ins, each with a different spoofed leftmost entry and the same rightmost entry. The 11th gets status 429.
- [ ] **Step 2: Run** `pnpm vitest run src/server/http/client-ip.test.ts tests/integration/auth-and-workspaces.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it, use it in `route()`, and add the env var to `.env.example` with a one-line note ("count of proxies you control in front of this app").
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** `pnpm check`, then commit `fix(security): derive client IP from trusted proxy hops only`.

### Task 4: Per-account throttling for sign-in and password reset (S3)

**Files:**

- Modify: `src/server/auth/auth-service.ts` (`signIn`, `requestPasswordReset`), `tests/integration/auth-and-workspaces.test.ts`

**Interfaces:**

- Consumes: `c.repos.rateLimit.hit(key, windowMs, now)`.
- Produces:
  - Bucket `signin-account:<lowercased trimmed email>`, limit 10 per 15 min. It is checked before password verification; over the limit throws `RATE_LIMITED`, the same message as the IP limit.
  - Bucket `forgot-account:<email>`, limit 3 per 60 min. Over the limit it returns success but sends nothing, so accounts can't be enumerated.

- [ ] **Step 1: Write failing tests:**
  - `11th sign-in for one email from 11 different IPs is rate limited`: expect status 429 and code `RATE_LIMITED`.
  - `correct password during lockout is still rate limited`.
  - `4th forgot-password for one email within an hour returns 200 but queues no 4th email`: count outbox rows for that address = 3.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/auth-and-workspaces.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both buckets.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** `pnpm check`, then commit `fix(security): per-account throttling for sign-in and password reset`.

### Task 5: Bind idempotent replays to the caller (S4)

**Files:**

- Modify: `src/server/http/route.ts` (idempotency block), `tests/integration/billing.test.ts`

**Interfaces:**

- Produces: the stored scope becomes `` `${config.idempotency({ params })}:u:${actor.userId}` `` for signed-in callers, and `` `${…}:anon` `` otherwise. Replay lookups use the same composite scope.

- [ ] **Step 1: Write failing tests:**
  - `another tenant's user cannot replay a payment response`: user A records a payment with key `K` on bill X. User B (another workspace) sends the same key and body to the same route. Expect 404, not a replay, and no `idempotent-replay` header.
  - `same user replay still works`: expect 200 and the `idempotent-replay: true` header.
  - `payment retry with pre-change key does not double-charge`: insert an idempotency record in the old scope format directly, then call with the same key. Expect the bill's paid total to increase exactly once, guarded by the payment service's own duplicate check. If it double-charges, stop and report; do not weaken the assertion.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/billing.test.ts`. Expected: the first test FAILS.
- [ ] **Step 3: Implement** the scope change.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** `pnpm check`, then commit `fix(security): bind idempotency replays to the calling user`.

### Task 6: Security headers (S6)

**Files:**

- Create: `src/server/http/security-headers.ts`, `src/server/http/security-headers.test.ts`
- Modify: `next.config.ts` (`headers()`)

**Interfaces:**

- Produces: `SECURITY_HEADERS: { key: string; value: string }[]`, used for `source: "/:path*"`. The exact values:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
  - The code uses none of camera, microphone or geolocation (checked 2026-11-07).

- [ ] **Step 1: Write the failing test** `security-headers.test.ts`: asserts each key/value above exactly, and that no `script-src` directive is present (a script policy needs nonces and is out of scope).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** it and spread it into `next.config.ts`.
- [ ] **Step 4: Run** the test, then `pnpm build && pnpm start`. In a second shell, `curl -sI http://localhost:3000/ | grep -iE "strict-transport|content-security|permissions-policy"`. Expected: all three present.
- [ ] **Step 5:** Run the Playwright smoke `pnpm test:e2e tests/e2e/site.spec.ts`. Expected: PASS (no page broken by the CSP).
- [ ] **Step 6:** Commit `fix(security): HSTS, CSP frame/object/base restrictions, Permissions-Policy`.

### Task 7: CI with secret scanning

**Files:**

- Create: `.github/workflows/ci.yml`, `.gitleaks.toml`
- Modify: `tests/e2e/zz-shot-tmp.spec.ts` (delete if it is a throwaway screenshot spec; check its content first and keep it if it asserts behaviour)

**Interfaces:**

- Produces jobs:
  - `verify`: Node 22, pnpm 10.28 with `--frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`.
  - `secrets`: `gitleaks/gitleaks-action@v2` with full history, config allow-listing `src/test/**`, `tests/**`, `.env.example`.
  - `audit`: `pnpm audit --prod --audit-level=high`.
  - Triggers: `pull_request` and `push` to `main`.

- [ ] **Step 1:** Write the workflow and config.
- [ ] **Step 2:** Run gitleaks locally on the full history: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --config /repo/.gitleaks.toml`. Expected: one finding class only, the cookie jars in commit `586e3b4`. Add that commit's two paths to the allowlist with a reference to `SECURITY.md`.
- [ ] **Step 3:** Run `pnpm audit --prod --audit-level=high`. Expected: exit 0. Otherwise list the advisories in the task report and stop; dependency upgrades are a separate decision.
- [ ] **Step 4:** Commit `ci: verify, secret scan and dependency audit workflow`.
- [ ] **Step 5: [OWNER APPROVAL]** Push the branch so CI runs. Do not push without approval.

## Phase 1 — Tenant isolation and RBAC (S5)

### Task 8: Request-scoped database context

**Files:**

- Create: `src/server/db-context.ts`, `src/server/db-context.test.ts`
- Modify: `src/server/http/route.ts`, `src/server/authz/access-service.ts` (`workspaceScope`)

**Interfaces:**

- Produces (in `src/server/db-context.ts`, `import "server-only"`, backed by `AsyncLocalStorage`):
  ```ts
  export interface DbContext {
    workspaceId: string | null;
    userId: string | null;
  }
  export function runWithDbContext<T>(fn: () => Promise<T>): Promise<T>;
  export function bindUser(userId: string): void;
  export function bindWorkspace(workspaceId: string): void;
  export function currentDbContext(): DbContext | null;
  export class TenantContextError extends Error {} // name "TenantContextError"
  ```
  - `bindWorkspace` throws `TenantContextError("TENANT_CONTEXT_CONFLICT")` when a different workspace is already bound.
  - Both binders throw `TenantContextError("TENANT_CONTEXT_MISSING")` outside `runWithDbContext`.
- `route()` wraps everything after `getContainer()` in `runWithDbContext` and calls `bindUser(actor.userId)` once the actor resolves.
- `workspaceScope()` calls `bindWorkspace(membership.workspaceId)` only after the membership is confirmed `ACTIVE`.

- [ ] **Step 1: Write failing unit tests:**
  - `binds and reads within a run`.
  - `contexts do not leak between concurrent runs`: two `Promise.all` runs bind different IDs; each reads its own.
  - `rebinding same workspace is a no-op`.
  - `binding a second workspace throws TENANT_CONTEXT_CONFLICT`.
  - `binding outside a run throws TENANT_CONTEXT_MISSING`.
- [ ] **Step 2: Run** `pnpm vitest run src/server/db-context.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it and wire it into `route()` and the access service.
- [ ] **Step 4: Run** the unit tests, then `pnpm test`. Expected: all PASS. Any `TENANT_CONTEXT_CONFLICT` in the suite is a request touching two workspaces: list it in the task report, because Task 11 must put that path on the system runner.
- [ ] **Step 5:** Commit `feat(tenancy): request-scoped database context`.

### Task 9: Tenant and system transaction runners

**Files:**

- Modify: `src/infrastructure/database/providers/postgres/client.ts`, `src/server/config/env.ts`, `src/test/harness.ts`
- Create: `src/infrastructure/database/providers/postgres/runners.test.ts`

**Interfaces:**

- Consumes: `currentDbContext()` from Task 8. It is injected as a function parameter so the adapter does not import `src/server`.
- Produces:
  ```ts
  export interface TenantRunnerOptions {
    role: string | null;
    context: () => DbContext | null;
  }
  export function createTenantRunner<R>(
    db: Executor,
    build: (e: Executor) => R,
    options: TenantRunnerOptions,
  ): TransactionRunner<R>;
  export function createSystemRunner<R>(
    db: Executor,
    build: (e: Executor) => R,
  ): TransactionRunner<R>;
  ```
  - `createTransactionRunner` is kept temporarily as an alias of `createSystemRunner`; Task 11 deletes it.
  - Tenant `run` and `read` both open a transaction. Then:
    - if `role` is set, run `SET LOCAL ROLE <role>` (role validated against `/^[a-z_][a-z0-9_]*$/`);
    - run `select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`, using empty strings for nulls;
    - then do the work.
    - With no context, or with both IDs null, throw `TenantContextError("TENANT_CONTEXT_MISSING")` before touching the database.
- Env: `DATABASE_TENANT_ROLE: z.string().default("ros_tenant")`. The value `none` disables the role switch (emergency rollback, logs `warn tenant_role_disabled` at startup). The test harness keeps the default.

- [ ] **Step 1: Write failing tests** (PGlite, migrated, Task 10 not yet applied, so test against a temp table created in the test with an RLS policy like the 2026-11-07 spike):
  - `tenant read sees only bound workspace rows`.
  - `tenant run without context throws TENANT_CONTEXT_MISSING`.
  - `settings do not leak to the next transaction on the same connection`: after a tenant run, a system read of `current_setting('app.workspace_id', true)` returns `''` or `null`.
  - `system runner is unaffected`.
- [ ] **Step 2: Run** `pnpm vitest run src/infrastructure/database/providers/postgres/runners.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the runners and the env var.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): tenant and system transaction runners`.

### Task 10: RLS migration

**Files:**

- Create: `src/infrastructure/database/providers/postgres/tenant-tables.ts`, migration `0002_tenant_rls.sql` (via `drizzle-kit generate --custom --name tenant_rls`), `src/infrastructure/database/providers/postgres/migrations-down/0002_tenant_rls.down.sql`, `tests/integration/security-rls.test.ts`

**Interfaces:**

- Produces: `TENANT_TABLES: readonly string[]`. These are exactly the 35 tables with a `workspace_id` column at `02e5eeb`:
  - `addon_groups, addons, audit_logs, bill_items, bills, branch_settings, branches, dining_tables, invitations`
  - `menu_categories, menu_item_branch_overrides, menu_items, menu_variants, menus`
  - `notifications, order_item_addons, order_items, order_status_history, orders, payment_history, payments`
  - `restaurant_settings, restaurants, role_assignments, roles, stored_files, subscription_events, subscriptions`
  - `support_requests, table_qr_tokens, table_session_members, table_sessions, upgrade_requests, workspace_entitlements, workspace_memberships`
- Produces SQL objects:
  - `app_current_workspace() RETURNS uuid` and `app_current_user() RETURNS uuid`. Both are `LANGUAGE sql STABLE`, returning `nullif(current_setting('app.<x>', true), '')::uuid`.
  - Roles `ros_tenant` and `ros_runtime`, both NOLOGIN, created in a `DO` block only if missing. Then `GRANT ros_tenant TO ros_runtime` and `GRANT ros_tenant TO CURRENT_USER`.
  - Grants: `USAGE ON SCHEMA public`; `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` and `USAGE, SELECT ON ALL SEQUENCES` to both roles; `ALTER DEFAULT PRIVILEGES` granting the same.
  - `REVOKE ALL ON sessions, auth_tokens, rate_limit_buckets, idempotency_records, email_outbox FROM ros_tenant`.
- Policies on each `TENANT_TABLES` table, with `ENABLE ROW LEVEL SECURITY` (no `FORCE`):
  - `tenant_isolation FOR ALL TO ros_tenant USING (workspace_id = app_current_workspace()) WITH CHECK (same)`
  - `runtime_access FOR ALL TO ros_runtime USING (true) WITH CHECK (true)`
- Exceptions (USING clause; WITH CHECK stays workspace-only):
  - `workspace_memberships`, `notifications`: `… OR user_id = app_current_user()`.
  - `roles`: `… OR workspace_id IS NULL` for SELECT only (a separate `FOR SELECT` policy). Writes to system roles are not allowed in tenant mode.
- The down script drops the policies and functions and runs `DISABLE ROW LEVEL SECURITY`. Roles are left in place, since they are harmless.

- [ ] **Step 1: Write failing tests** in `security-rls.test.ts`, using fixtures for two workspaces A and B, each with one row in every tenant table (extend `src/test/fixtures*.ts` helpers; reuse existing creators):
  - `every table with a workspace_id column has RLS enabled and both policies`: query `pg_class.relrowsecurity` and `pg_policies` for every table that has a `workspace_id` column in `information_schema.columns`, and compare to `TENANT_TABLES`. This catches future tables.
  - For each table: `tenant context A sees zero rows of B in <table>`.
  - `insert with B's workspace_id under A's context fails with 42501`.
  - `tenant context cannot read sessions (42501)`.
  - `user-bound context sees own memberships across workspaces and nobody else's`.
  - `system roles are readable in tenant context, not writable`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/security-rls.test.ts`. Expected: FAIL (no policies).
- [ ] **Step 3: Write the migration and the down script.**
- [ ] **Step 4: Run** the RLS tests. Expected: PASS. Then run the full `pnpm test`. Expected: PASS unchanged, because no composition uses the tenant runner yet (that is Task 11) and the owner bypasses non-forced RLS.
- [ ] **Step 5: Rehearse on a copy.** Run `cp -R .data/snapshots/<latest> .data/rehearsal/t10`, then `PGLITE_DATA_DIR=.data/rehearsal/t10 pnpm db:migrate`, then compare `countRows` with the snapshot's `manifest.json`. Expected: identical counts.
- [ ] **Step 6:** Commit `feat(security): row-level security for all tenant tables`.

### Task 11: Move every composition to the tenant runner; system allow-list

**Files:**

- Modify: all of `src/server/composition/*.ts`; `src/server/container.ts`; `src/server/modules/ordering/service.ts` (guest lookups at lines ~123 and ~131); `src/server/modules/tenancy/people-service.ts` (invitation token preview/accept); `src/server/modules/workspaces/service.ts` (`create`); `src/infrastructure/database/providers/postgres/client.ts` (delete the `createTransactionRunner` alias)
- Create: `tests/integration/security-runner-allowlist.test.ts`

**Interfaces:**

- System runner allow-list (exact). Each call site carries a one-line reason comment:
  1. `container.ts` core repos: identity, access, rateLimit, idempotency, emailOutbox, audit.
  2. `entitlementRepository`.
  3. `composition/platform.ts`: Super Admin and scheduled jobs.
  4. `composition/dev-mailbox.ts`.
  5. A `lookup` system runner injected into the ordering service, used only for `findTableByQrHash` and the guest-token session lookup. Right after a successful lookup the service calls `bindWorkspace(found.workspaceId)`.
  6. A `lookup` runner in the people service for the invitation-token preview/accept lookup, which then binds the invitation's workspace.
  7. `workspaces.create` (bootstrap: the workspace does not exist yet) and the workspace listing for the signed-in user (`/auth/me`, switcher). Both filter by `actor.userId` in SQL.
- Everything else uses `createTenantRunner(c.db, build, { role: tenantRole(c.env), context: currentDbContext })`, where `tenantRole(env)` returns `null` for `"none"`.

- [ ] **Step 1: Write failing tests** in `security-runner-allowlist.test.ts`:
  - `createSystemRunner is only used in allow-listed files`: read the source of `src/server/**/*.ts` and assert the set of files containing `createSystemRunner(` equals the allow-list file set above.
  - `createTransactionRunner no longer exists`.
  - `workspace listing returns only the caller's workspaces` (user in A, not B).
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/security-runner-allowlist.test.ts`. Expected: FAIL.
- [ ] **Step 3: Convert** the compositions, inject the lookup runners, and add the bind calls.
- [ ] **Step 4: Run** `pnpm test`. Expected: all ≥ 368 + new tests PASS with RLS active. Each failure means either a missing bind (fix the path) or a cross-tenant query (fix the query). Never add a path to the allow-list without stating the reason in the task report.
- [ ] **Step 5:** Run Playwright `pnpm test:e2e`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(security): tenant runner everywhere; explicit system allow-list`.

### Task 12: Cross-tenant HTTP isolation suite

**Files:**

- Create: `tests/integration/security-tenant-isolation.test.ts`

**Interfaces:**

- Consumes: `call`, `cookieFrom`, fixtures.
- Produces: a table `ISOLATION_CASES: { route: string; method: string; handler: Handler; params: (a: Fixture) => Record<string,string>; body?: unknown }[]`.

- [ ] **Step 1: Write the tests:**
  - For every case: `user of workspace B gets 404 for A's <route>`. Assert A's data is unchanged afterwards, using the resource's GET as A.
  - `every dynamic route is covered`: glob `src/app/api/v1/**/route.ts` with `[`-segments, excluding `admin/**`, `public/**`, `invitations/[token]/**`, `files/**`, `test/**`, `dev/**` (each covered by its own suite). Assert every remaining `route + exported method` appears in `ISOLATION_CASES`.
  - `SSE stream for another tenant's branch is 404`.
  - `file key from workspace A is served (public-by-key) but cannot be listed or deleted by B`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/security-tenant-isolation.test.ts`. Expected: PASS. A failure is a real vulnerability: fix it in the owning service, keep the test, and list it in the report.
- [ ] **Step 3:** Commit `test(security): cross-tenant isolation suite with route coverage guard`.

### Task 13: RBAC matrix suite

**Files:**

- Create: `tests/integration/security-rbac-matrix.test.ts`

**Interfaces:**

- Consumes: `ROLE_TEMPLATE_LIST` and `PERMISSIONS` from `src/domain/access/permissions.ts`.
- Produces: `RBAC_ACTIONS: { permission: Permission; level: "workspace" | "restaurant" | "branch"; invoke: (ctx) => Promise<CallResult> }[]`. It has one entry per permission that guards a mutation or a sensitive read, chosen from the route handlers' `scope.require(...)` calls.

- [ ] **Step 1: Write the tests:**
  - For each of the 7 system role templates × each action: `<role> <allowed|denied> <permission>`. The expected value is `template.permissions.includes(permission)`. Allowed → 2xx; denied → 403 `FORBIDDEN` (or 404 where the scope hides the resource).
  - `branch-assigned waiter is 404 at another branch of the same restaurant`.
  - `restaurant manager is 404 for another restaurant in the same workspace`.
  - `non-admin gets 403 on every /api/v1/admin route` (enumerated by glob).
  - `suspended workspace denies every action with WORKSPACE_RESTRICTED`.
  - `removed member's next request is 404`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/security-rbac-matrix.test.ts`. Expected: PASS. Treat a failure like Task 12.
- [ ] **Step 3:** Commit `test(security): RBAC matrix across system roles`.

## Phase 2 — Subscription enforcement

### Task 14: Workspace-limit domain rules and new settings

**Files:**

- Create: `src/domain/subscriptions/workspace-limit.ts`, `src/domain/subscriptions/workspace-limit.test.ts`
- Modify: `src/domain/platform/settings.ts`, `src/domain/shared/errors.ts`, `src/server/http/errors.ts`, any existing tests asserting `trialDays: 30` or `[7, 15, 25]`

**Interfaces:**

- Produces:
  ```ts
  export interface WorkspaceLimitInput {
    phase: SubscriptionPhase;
    billingCycle: BillingCycle | null;
    planMaxWorkspaces: number | null;
    overrideMaxWorkspaces: number | null;
    fairUseMaxWorkspaces: number;
  }
  export function effectiveMaxWorkspaces(i: WorkspaceLimitInput): number;
  export function assertCanCreateWorkspace(
    i: WorkspaceLimitInput & {
      currentWorkspaces: number;
      createdLast24h: number;
      createsPerDay: number;
    },
  ): void; // LIMIT_REACHED with details { reason: "PLAN_LIMIT" | "FAIR_USE" | "DAILY_LIMIT", limit }
  ```
  - Order: a non-null override wins → TRIAL or GRACE gives 1 → MONTHLY gives 1 → otherwise `planMaxWorkspaces ?? fairUseMaxWorkspaces`.
- Settings additions: `fairUseMaxWorkspaces: z.number().int().min(1).max(1000)` default 25; `workspaceCreatesPerDay: z.number().int().min(1).max(100)` default 5; `maintenanceMode: z.boolean()` default false (used in Task 22).
- Settings defaults changed: `trialDays: 15`, `trialReminderDays: [7, 12, 14]`.
- New error codes: `TRIAL_ALREADY_USED` → 409; `MAINTENANCE` → 503.

- [ ] **Step 1: Write failing tests** with exact values:
  - TRIAL pro (plan 3) → 1; GRACE annual → 1; ACTIVE MONTHLY pro → 1; ACTIVE ANNUAL pro → 3.
  - ACTIVE ANNUAL enterprise (null) → 25; enterprise override 40 → 40; TRIAL override 2 → 2.
  - Annual pro with 3 current → `LIMIT_REACHED`/`PLAN_LIMIT`; enterprise 25 current → `FAIR_USE`; `createdLast24h: 5` → `DAILY_LIMIT`.
  - `DEFAULT_PLATFORM_SETTINGS.trialDays === 15`.
- [ ] **Step 2: Run** `pnpm vitest run src/domain`. Expected: FAIL.
- [ ] **Step 3: Implement** it, and update the tests that pinned the old defaults so they use the constants.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(subscriptions): workspace limit rules, fair use, 15-day trial defaults`.

### Task 15: Organizations: expand and backfill migration

**Files:**

- Modify: `src/infrastructure/database/providers/postgres/schema/tenancy.ts`, `schema/platform.ts`, `tenant-tables.ts`
- Create: migration `0003_organizations.sql` (drizzle-generated DDL plus appended backfill), `src/test/migrate-to.ts`, `tests/integration/migration-organizations.test.ts`

**Interfaces:**

- Schema:
  - `organizations`: `id`, `name`, `created_by → users` (`on delete set null`), `status text default 'ACTIVE'`, `max_workspaces_override integer null`, timestamps.
  - `organization_members`: `organization_id → organizations` (cascade), `user_id → users` (cascade), `role text check in ('OWNER','BILLING_ADMIN')`, unique `(organization_id, user_id)`.
  - `workspaces.organization_id uuid null → organizations`.
  - `subscriptions.organization_id uuid null → organizations`, plus a partial unique index `subscriptions_current_org_uq ON (organization_id) WHERE is_current AND organization_id IS NOT NULL`.
- Backfill, which is idempotent and reuses the workspace's UUID as its organization's UUID:
  - `INSERT INTO organizations (id, name, created_by, created_at, updated_at) SELECT id, name, created_by, created_at, now() FROM workspaces ON CONFLICT (id) DO NOTHING`.
  - `organization_members` OWNER = `workspaces.created_by` when it is not null, else the earliest `workspace_owner` membership.
  - `UPDATE workspaces SET organization_id = id WHERE organization_id IS NULL`.
  - `UPDATE subscriptions SET organization_id = workspace_id WHERE organization_id IS NULL`.
- RLS for the new tables (same migration):
  - `organizations`: tenant policy `id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace()) OR id IN (SELECT organization_id FROM organization_members WHERE user_id = app_current_user())`.
  - `organization_members`: `organization_id = (… same subquery …) OR user_id = app_current_user()`.
  - `runtime_access` as in Task 10.
  - Add both tables to a new exported `ORGANIZATION_TABLES` list, which the Task 10 schema test also checks.
- `migrateTo(handle, lastTag)` copies the migrations folder to a temp dir with the journal truncated after `lastTag`, then runs the migrator.

- [ ] **Step 1: Write failing tests** in `migration-organizations.test.ts`:
  - `backfill preserves every row and trial date`: `migrateTo('0002_tenant_rls')`. Insert via SQL two users and three workspaces: W1 trialing with `trial_ends_at = '2026-11-30T10:00:00Z'`, W2 ACTIVE ANNUAL, W3 with a null `created_by` and one `workspace_owner` membership. Snapshot `countRows`, run all migrations, then assert:
    - every workspace has `organization_id = id`;
    - every subscription has `organization_id = workspace_id`;
    - W1's `trial_ends_at` is unchanged to the millisecond;
    - W3's org owner is the membership user;
    - every pre-existing table's count is unchanged;
    - `organizations` has 3 rows.
  - `backfill is idempotent`: re-running the backfill SQL changes nothing.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/migration-organizations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, `pnpm db:generate`, and append the backfill and RLS SQL.
- [ ] **Step 4: Run** the migration tests and the full `pnpm test`. Expected: PASS.
- [ ] **Step 5: Rehearse** on a fresh copy of the snapshot, as in Task 10 Step 5. Expected: pre-existing counts identical; `organizations` count = `workspaces` count.
- [ ] **Step 6:** Commit `feat(billing): organizations with backfill from workspaces`.

### Task 16: Entitlements resolve per organization (switch, dual-write)

**Files:**

- Modify: `src/server/subscriptions/entitlement-service.ts`, `src/server/ports/core-repositories.ts`, `repositories/core.ts` (`loadSubscriptionContext`, ~line 315), every subscription write site (`grep -rn "insertSubscription\|update(subscriptions)" src`), `src/server/modules/platform/service.ts`
- Create: `src/app/api/v1/admin/organizations/[organizationId]/route.ts`, `tests/integration/organization-billing.test.ts`
- Modify (UI): `src/features/superadmin/workspace-detail-page.tsx` (organization name, override field)

**Interfaces:**

- `loadSubscriptionContext(workspaceId)` joins `workspaces.organization_id` and reads the current subscription by `organization_id`. It returns the existing fields plus `organization: { id: string; maxWorkspacesOverride: number | null }` and `billingCycle`.
- Writes set both `organization_id` and `workspace_id`. For new rows, `workspace_id` is the organization's first workspace (`min(created_at)`).
- `EntitlementService.getOrganizationEntitlements(organizationId): Promise<Entitlements>`; the workspace variant delegates to it.
- `PATCH /api/v1/admin/organizations/:organizationId` with body `{ maxWorkspacesOverride: number | null }` (platform auth). It writes audit `organization.limit_override_changed` with old and new values.

- [ ] **Step 1: Write failing tests:**
  - `two workspaces in one organization share the plan`: Super Admin activates ANNUAL pro on the org; both workspaces report `planKey: "pro"`, phase `ACTIVE`.
  - `expiry of the organization's period restricts every workspace in it`.
  - `override endpoint is platform-only and audited`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/organization-billing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS, including every existing subscription and admin test unchanged.
- [ ] **Step 5:** Commit `feat(billing): resolve entitlements per organization`.

### Task 17: Trial defaults and plan workspace limits data migration

**Files:**

- Modify: `schema/platform.ts` (`subscription_plans.max_workspaces integer null default 1`), `system-data.ts` (`DEFAULT_PLANS`: starter 1, pro 3, enterprise null), the Super Admin plan editor (`src/features/superadmin/` plans page, field "Max workspaces", blank = unlimited with fair use), `src/contracts/platform.ts`
- Create: migration `0004_trial_and_workspace_limits.sql`, `tests/integration/migration-trial-defaults.test.ts`

**Interfaces:**

- The migration:
  - adds the column;
  - sets `max_workspaces`: `UPDATE subscription_plans SET max_workspaces = 3 WHERE key='pro'`, `NULL WHERE key='enterprise'`; other plans keep the default 1;
  - `UPDATE platform_settings SET value='15'::jsonb WHERE key='trialDays' AND value='30'::jsonb`;
  - `UPDATE platform_settings SET value='[7,12,14]'::jsonb WHERE key='trialReminderDays' AND value='[7,15,25]'::jsonb`.
- Produces: `plan.maxWorkspaces: number | null` on the entitlement context from Task 16, consumed by Task 18 as `planMaxWorkspaces`.

- [ ] **Step 1: Write failing tests:**
  - `default trialDays 30 becomes 15`.
  - `admin-edited trialDays 21 is kept`.
  - `edited reminder days are kept`.
  - `pro gets 3, enterprise null, custom plan 1`.
  - `legacy trial keeps its end date and gets accurate reminder text`: a trial created with 30 days before the migration. After it: `trial_ends_at` unchanged. Run the sweep at day 12 (test clock); the queued email states `18 days`, the true remainder. Grace starts at the original end.
  - `new trial after migration ends 15 days after creation`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/migration-trial-defaults.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test`, then rehearse on a snapshot copy (Task 10 Step 5). Expected: PASS; counts unchanged.
- [ ] **Step 5:** Commit `feat(billing): 15-day trial default, reminder days, plan workspace limits`.

### Task 18: Workspace creation rules (one per Trial/Monthly, Annual limits, fair use, single trial)

**Files:**

- Modify: `src/server/modules/workspaces/service.ts` (`create`), `src/server/modules/workspaces/ports.ts`, `repositories/workspaces.ts`, `src/contracts/workspaces.ts`, `src/app/api/v1/workspaces/route.ts`
- Create: `src/app/api/v1/organizations/route.ts` (GET mine), `tests/integration/workspace-limits.test.ts`
- Modify (UI): the workspace-create form in `src/features/workspaces/` (organization picker only when the user owns more than 1 org; `LIMIT_REACHED` shows the existing upgrade-request call to action; `TRIAL_ALREADY_USED` shows "upgrade your existing organization")

**Interfaces:**

- Body adds `organizationId?: uuid`. Rules:
  - The actor owns 0 orgs: create an org, the workspace, an org OWNER member, and a TRIALING subscription with `trialEndsAt = now + settings.trialDays`. If any org created by the actor ever had a subscription with `trial_starts_at` not null, throw `TRIAL_ALREADY_USED`.
  - No `organizationId` and the actor owns exactly 1 org: use it.
  - No `organizationId` and the actor owns more than 1: `VALIDATION_FAILED` with `fieldErrors.organizationId = ["Choose an organization"]`.
  - With an org: the actor must be OWNER, otherwise 404. Call `assertCanCreateWorkspace` with `currentWorkspaces` (count in org), `createdLast24h` (org workspaces created after `now - 24h`) and settings. The new workspace adds no subscription row.
  - On `LIMIT_REACHED` with reason `FAIR_USE` or `DAILY_LIMIT`, audit `organization.fair_use_limit_hit`.
- `GET /api/v1/organizations` returns `{ id, name, role, workspaceCount, maxWorkspaces: number }[]` for the actor.

- [ ] **Step 1: Write failing tests** (test clock and the Super Admin plan endpoints to set phases):
  - `trial org cannot create a second workspace` → 402 `LIMIT_REACHED`, reason `PLAN_LIMIT`.
  - `monthly pro org cannot create a second workspace`.
  - `annual pro org creates 3, 4th is refused`.
  - `annual enterprise org is stopped at 25 (fair use)`: set `fairUseMaxWorkspaces: 3` via admin settings to keep the test fast; the 4th is refused with reason `FAIR_USE`.
  - `6th creation in 24h is refused (DAILY_LIMIT)`: set `workspaceCreatesPerDay: 2`; the 3rd is refused; after the clock moves +24h it succeeds.
  - `override 2 lets a trial org hold 2`.
  - `user who already used a trial gets TRIAL_ALREADY_USED for a new org`.
  - `legacy multi-org owner must choose organization`: after the backfill a user owns 2 orgs. Without `organizationId` → 422; with one → success. Both original workspaces still return `200` on GET.
  - `non-owner member cannot create in the org` → 404.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/workspace-limits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test` and `pnpm test:e2e`. Expected: PASS (onboarding still creates the first workspace).
- [ ] **Step 5:** Commit `feat(billing): workspace limits per organization with fair use and single trial`.

### Task 19: Feature catalogue truth and `kitchen_display` enforcement

**Files:**

- Modify: `src/domain/subscriptions/entitlements.ts` (`FEATURES` → `FEATURE_META`), `src/server/modules/staff-ops/service.ts` (`kitchenFeed` ~line 452, `setItemStatus` ~line 357), `src/app/api/v1/branches/[branchId]/events/route.ts`, `src/features/site/pricing/*`, the Super Admin plan editor
- Create: `tests/integration/feature-enforcement.test.ts`

**Interfaces:**

- `FEATURE_META: Record<FeatureKey, { label: string; advertised: boolean }>`. Advertised: `qr_ordering, kitchen_display, multi_branch, analytics, advanced_analytics, custom_roles`. Not advertised: `offline_mode, email_notifications, push_notifications, data_export`. `FEATURES` stays as a derived label map so existing imports compile. `ADVERTISED_FEATURES: FeatureKey[]`.
- `kitchenFeed` and `setItemStatus` call `assertFeature(scope.entitlements, "kitchen_display")`. The events route asserts it when the stream is granted through `kitchen.view` only.

- [ ] **Step 1: Write failing tests:**
  - `plan without kitchen_display gets 402 ENTITLEMENT_REQUIRED on kitchen feed, item status and kitchen-only event stream`.
  - `plan with it gets 200`.
  - `waiter event stream (orders.view) is unaffected`.
  - `every advertised feature has an enforcement call site`: for each key in `ADVERTISED_FEATURES`, the source under `src/server/**` contains `assertFeature(` or `features.includes(` with that key literal.
  - `pricing API lists only advertised features`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/feature-enforcement.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS. All three default plans include `kitchen_display` (verified in `system-data.ts`).
- [ ] **Step 5: Check stored plans** on a snapshot copy: `select key, features from subscription_plans`. If any plan with current subscriptions lacks `kitchen_display`, stop and ask the owner before committing, because those kitchens would lose the screen.
- [ ] **Step 6:** Commit `feat(subscriptions): enforce kitchen_display; advertise only enforced features`.

### Task 20: Subscription enforcement matrix

**Files:**

- Create: `tests/integration/security-subscription-enforcement.test.ts`

- [ ] **Step 1: Write the tests.** One org on a trial created at T0, using the test clock. For each phase, each action is checked against `isOperationAllowed(accessLevel, kind)`:
  - Phases: day 1 TRIAL/FULL, day 16 GRACE/LIMITED, day 23 RESTRICTED/READ_ONLY, and a Super Admin suspension (SUSPENDED/NONE).
  - Actions: create restaurant (grow), invite staff (grow), create workspace (grow), place staff order (operate), edit menu item (operate), record payment on an open bill (settle), view analytics (read).
  - Plus `a second workspace in the same annual org follows the org's phase`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/security-subscription-enforcement.test.ts`. Expected: PASS. Treat a failure as a bug in the owning service.
- [ ] **Step 3:** Commit `test(billing): subscription enforcement matrix by phase`.

## Phase 3 — Provider independence

### Task 21: Allowed origins and QR base URL

**Files:**

- Modify: `src/server/config/env.ts`, `src/server/http/route.ts` (`assertSameOrigin`), `src/server/composition/tables.ts`, `.env.example`, `tests/integration/auth-and-workspaces.test.ts`, `tests/integration/tables.test.ts`

**Interfaces:**

- `ALLOWED_ORIGINS`: comma-separated origins, parsed into `string[]` of `new URL(x).origin`; default `[origin of APP_URL]`.
- `QR_BASE_URL`: `z.url()`, default `APP_URL`.
- `assertSameOrigin(req, allowed: string[])` no longer trusts `new URL(req.url).origin`.

- [ ] **Step 1: Write failing tests:**
  - `mutation from each allowed origin passes` (three origins).
  - `mutation from an unlisted origin is 403`.
  - `request whose Host matches but Origin is unlisted is 403`.
  - `QR link uses QR_BASE_URL`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/auth-and-workspaces.test.ts tests/integration/tables.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(platform): ALLOWED_ORIGINS and QR_BASE_URL`.

### Task 22: Health endpoints and maintenance mode

**Files:**

- Create: `src/app/api/v1/health/route.ts`, `src/app/api/v1/health/ready/route.ts`, `tests/integration/health-maintenance.test.ts`
- Modify: `src/server/http/route.ts`, the Super Admin settings page (maintenance toggle)

**Interfaces:**

- `GET /api/v1/health` → `200 { data: { status: "ok", version: env APP_VERSION ?? "dev" } }`, with no database access.
- `GET /api/v1/health/ready` → 200 when `select 1` succeeds and `pendingMigrations` is empty. Otherwise 503 with `{ error: { code: "INTERNAL_ERROR", message: "not ready" } }`.
- In maintenance mode every mutation returns 503 `MAINTENANCE`. Exceptions: `auth: "platform"` routes, `skipOriginCheck` job routes, and `auth/signin`/`auth/signout`. Settings are cached in-process for 10 s.

- [ ] **Step 1: Write failing tests** for each behaviour above, plus `GET requests still work in maintenance mode`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/health-maintenance.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ops): health/readiness endpoints and maintenance mode`.

### Task 23: S3-compatible storage adapter

**Files:**

- Create: `src/infrastructure/storage/providers/s3-storage.ts`, `src/infrastructure/storage/object-storage.contract.ts`, `src/infrastructure/storage/providers/local-storage.test.ts`, `src/infrastructure/storage/providers/s3-storage.test.ts`
- Modify: `src/server/container.ts` (`selectStorage`), `src/server/config/env.ts` (add `S3_FORCE_PATH_STYLE` booleanish, default false), `package.json` (add `@aws-sdk/client-s3`)

**Interfaces:**

- `createS3Storage(cfg: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }): ObjectStorage`. `name: "s3"`. `url(key)` returns `/api/v1/files/${key}`, so the bucket stays private and the existing CSP-sandboxed file route serves it. `get` returns `null` on `NoSuchKey`.
- `runObjectStorageContract(make: () => Promise<ObjectStorage>)`: put/get round trip with content type, missing key → null, delete, and keys with `..` rejected.
- `selectStorage`:
  - `STORAGE_PROVIDER=s3` with any `S3_*` missing throws at startup: `S3 storage selected but S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required`. This removes today's silent fallback to local disk.

- [ ] **Step 1: Write failing tests:**
  - The local contract always runs.
  - The S3 contract runs when `S3_TEST_ENDPOINT` is set, otherwise `it.skip` with the reason printed.
  - `startup fails loudly when s3 is selected without credentials`.
- [ ] **Step 2: Run** `pnpm vitest run src/infrastructure/storage`. Expected: FAIL.
- [ ] **Step 3: Implement** the adapter.
- [ ] **Step 4: Run** the tests against local MinIO (a local container, free):
  - `docker run -d --rm --name ros-minio -p 9000:9000 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio-dev-secret minio/minio server /data`
  - create bucket `ros-test` (`docker exec ros-minio mc mb /data/ros-test` or the AWS CLI)
  - `S3_TEST_ENDPOINT=http://localhost:9000 pnpm vitest run src/infrastructure/storage`
  - Expected: both contracts PASS. Then `docker stop ros-minio`.
- [ ] **Step 5:** Commit `feat(storage): S3-compatible adapter; fail fast on missing config`.

### Task 24: Postgres LISTEN/NOTIFY realtime adapter

**Files:**

- Create: `src/infrastructure/realtime/providers/postgres-bus.ts`, `src/infrastructure/realtime/providers/postgres-bus.test.ts`
- Modify: `src/server/config/env.ts` (`REALTIME_PROVIDER` adds `"postgres"`), `src/server/container.ts`

**Interfaces:**

- `createPostgresBus(cfg: { connectionString: string; logger: Logger }): RealtimeBus & { close(): Promise<void> }`.
  - One dedicated `pg.Client` runs `LISTEN ros_realtime`.
  - `publish` runs `select pg_notify('ros_realtime', $1)` with payload `JSON.stringify({ c: channel, e: { ...event, at } })`.
  - Payloads over 7,900 bytes are dropped with `warn realtime_payload_too_large`.
  - Reconnect backoff is 1 s doubling to 30 s, logging `realtime_reconnected` after a reconnect.
  - Listeners are delivered in-process, as in `memory-bus`.
- Selecting `postgres` with `DATABASE_PROVIDER=pglite` throws at startup.

- [ ] **Step 1: Write failing tests** (they run when `PG_TEST_URL` is set):
  - `event published on bus A reaches a subscriber on bus B within 2 s`.
  - `unsubscribe stops delivery`.
  - `oversized payload is dropped and logged`.
- [ ] **Step 2: Run** them with local Postgres 18: `docker run -d --rm --name ros-pg -p 55432:5432 -e POSTGRES_PASSWORD=dev postgres:18`, then `PG_TEST_URL=postgres://postgres:dev@localhost:55432/postgres pnpm vitest run src/infrastructure/realtime`. Expected: FAIL.
- [ ] **Step 3: Implement** the adapter.
- [ ] **Step 4: Run** the tests again. Expected: PASS. Keep `ros-pg` running for Task 25.
- [ ] **Step 5:** Commit `feat(realtime): Postgres LISTEN/NOTIFY bus for multi-instance deployments`.

### Task 25: Provider-neutral dump, restore and verify, plus local-data rehearsal

**Files:**

- Create: `scripts/db-dump.ts`, `scripts/db-restore.ts`, `scripts/db-verify.ts`, `scripts/smoke.ts`, `tests/integration/db-tools.test.ts`
- Modify: `package.json` (add `@electric-sql/pglite-tools` dev dependency; scripts `db:dump`, `db:restore`, `db:verify`, `smoke`)

**Interfaces:**

- `pnpm db:dump --out <file>`:
  - postgres → `pg_dump --format=custom --no-owner "$DATABASE_URL"` (ACLs kept: the tenant grants and policies are restored from the dump, never by re-applying migration SQL);
  - pglite → `pgDump({ pg, args: ["--no-owner"] })` from `@electric-sql/pglite-tools`, writing plain SQL with the dump's `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` statements rewritten without `FOR ROLE`, so they bind to whoever restores;
  - writes `<file>.manifest.json` with `countRows`.
- `pnpm db:restore --in <file> --target-url <url>`:
  - refuses (exit 2) unless the target has zero tables in `public`, so it never overwrites;
  - custom format → `pg_restore --no-owner --exit-on-error`; `.sql` → `psql -v ON_ERROR_STOP=1`.
- `pnpm db:verify --manifest <file> --target-url <url>` exits 1 and prints a diff table on any per-table count mismatch.
- `pnpm smoke --base-url <url>`: the order-to-payment HTTP flow (sign in as owner → table QR → guest join → order → accept → bill → payment → bill PAID). It uses only public HTTP and is reused in Phase 4.

- [ ] **Step 1: Write failing tests:**
  - `restore refuses a non-empty target`.
  - `verify detects a missing row`.
  - `dump→restore round-trip preserves counts`: PGlite to PGlite in-memory via plain SQL.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/db-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the scripts.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(data): provider-neutral dump/restore/verify and HTTP smoke script`.
- [ ] **Step 6: Rehearsal on Postgres 18 (local only, from a copy):**
  1. `cp -R .data/snapshots/<latest> .data/rehearsal/t25`
  2. `PGLITE_DATA_DIR=.data/rehearsal/t25 DATABASE_PROVIDER=pglite pnpm db:dump --out .data/rehearsal/t25.sql`
  3. `docker exec ros-pg createdb -U postgres ros_rehearsal`
  4. `pnpm db:restore --in .data/rehearsal/t25.sql --target-url postgres://postgres:dev@localhost:55432/ros_rehearsal`
  5. `DATABASE_URL=… pnpm db:migrate`
  6. `pnpm db:verify --manifest .data/rehearsal/t25.sql.manifest.json --target-url …` (pre-existing tables only)
  7. Start the app against it and run `pnpm smoke --base-url http://localhost:3000`

  Expected: identical counts and smoke PASS. If the restore fails on a PGlite-specific statement, record it and fix the dump step (for example filter PGlite-only `SET`s). Never fix it by editing the source data.

## Phase 4 — Monorepo and independent deployability

Read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` (standalone, `outputFileTracingRoot`), `turbopack.md` (`turbopack.root` in monorepos) and `01-app/02-guides/self-hosting.md` (streaming) before Task 26.

**Package names and import mapping** (applied by `scripts/codemod-imports.mjs`, which rewrites import specifiers only; files move with `git mv` to keep history):

| From                                                                                           | To                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `@/domain/*`                                                                                   | `@ros/domain/*` (`packages/domain/src`)                           |
| `@/contracts/*`                                                                                | `@ros/contracts/*` (`packages/contracts/src`)                     |
| `@/server/*` except `container`, `composition/*`                                               | `@ros/application/*` (`packages/application/src`)                 |
| `@/server/container`, `@/server/composition/*`                                                 | `apps/api/src/composition/*` (local `@/` alias inside `apps/api`) |
| `@/infrastructure/database/*`                                                                  | `@ros/database/*` (`packages/database/src`)                       |
| `@/infrastructure/{auth,email,logging,push,realtime,storage}/*`                                | `@ros/adapters/*` (`packages/adapters/src`)                       |
| `@/components/*`                                                                               | `@ros/ui/*` (`packages/ui/src`)                                   |
| `@/lib/api-client`                                                                             | `@ros/api-client` (`packages/api-client/src`)                     |
| `@/lib/*` (others), `@/features/{session,navigation,notifications,account,realtime,offline}/*` | `@ros/web-core/*` (`packages/web-core/src`)                       |
| `@/features/<x>/*` used by exactly one app                                                     | that app's `features/<x>/*`                                       |
| `@/features/<x>/*` used by two or more apps                                                    | `@ros/web-core/features/<x>/*`                                    |

**Route ownership:** console takes `(public)`, `(auth)`, `app`, `t`, `print`, `dev`, `design-system`, `~offline`, `serwist`, `sw.ts`. Ops takes `waiter`, `kitchen`, `cashier`, its own `~offline`, `serwist` and `sw.ts`. Admin takes `admin`. API takes `api/**`.

Internal packages are TypeScript source packages, consumed through `exports` pointing at `./src/*.ts` and Next `transpilePackages`; they have no build step.

### Task 26: Workspace skeleton and shared tooling

**Files:**

- Modify: `pnpm-workspace.yaml` (`packages: ["apps/*", "packages/*"]`), root `package.json` (scripts delegate to `turbo run …`; add `turbo` dev dependency)
- Create: `turbo.json` (tasks `build` with outputs `.next/**` excluding `.next/cache/**`, `typecheck`, `lint`, `test`, `format:check`), `packages/tooling/{tsconfig.base.json, eslint.base.mjs, package.json}`, `scripts/codemod-imports.mjs`, `scripts/codemod-imports.test.mjs`

- [ ] **Step 1: Write the codemod's failing test**: given the mapping table above, an input file with each `From` form → expected output; dynamic `import("@/…")` is also rewritten; non-matching specifiers are untouched.
- [ ] **Step 2: Run** `node --test scripts/codemod-imports.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the codemod and the skeleton. Still a single app at this point.
- [ ] **Step 4: Run** `pnpm check && pnpm build`. Expected: PASS (nothing moved yet).
- [ ] **Step 5:** Commit `build: pnpm workspaces, Turborepo, shared tooling, import codemod`.

### Task 27: Extract domain and contracts packages

**Files:**

- Move: `src/domain/**` → `packages/domain/src/**`; `src/contracts/**` → `packages/contracts/src/**`
- Create: `packages/domain/package.json` (no dependencies besides `zod`), `packages/contracts/package.json`, each with a `vitest` project config
- Modify: the root Vitest config (`test.projects`), and imports across the repo via the codemod

- [ ] **Step 1:** `git mv` the directories, then run the codemod for the two mappings.
- [ ] **Step 2:** Add an ESLint rule in `packages/domain`: `no-restricted-imports` for anything outside `@ros/domain` and `zod`.
- [ ] **Step 3: Run** `pnpm check && pnpm build`. Expected: PASS with the same test count as before the task.
- [ ] **Step 4:** Commit `refactor: extract @ros/domain and @ros/contracts`.

### Task 28: Extract application, adapters and database packages

**Files:**

- Move:
  - `src/server/**` (minus `container.ts`, `composition/`) → `packages/application/src/**`
  - `src/infrastructure/{auth,email,logging,push,realtime,storage}` → `packages/adapters/src/*`
  - `src/infrastructure/database/**`, `scripts/{migrate,seed,make-admin,db-*,revoke-cookie-jar}.ts`, `drizzle.config.ts` → `packages/database/{src,scripts}`
  - `src/server/container.ts`, `src/server/composition/**` → `apps/api/src/composition/**` (created now; becomes a Next app in Task 29)
  - `src/test/**` → `packages/testing/src/**` (`@ros/testing`)
- Modify:
  - `client.ts` `MIGRATIONS_DIR` = `fileURLToPath(new URL("./migrations", import.meta.url))`, no longer `process.cwd()`.
  - The Task 11 allow-list test paths.

**Interfaces:**

- Dependency rules enforced by ESLint `no-restricted-imports` in each package's config:
  - `application` must not import `@ros/adapters` or `@ros/database` (ports only).
  - `adapters` and `database` must not import `@ros/application`.
  - Frontends (Task 30) must not import `@ros/application`, `@ros/adapters` or `@ros/database`.

- [ ] **Step 1:** Move the files and run the codemod.
- [ ] **Step 2:** Add a test `packages/database/src/migrations-dir.test.ts`: `MIGRATIONS_DIR exists and contains _journal.json regardless of cwd`, run with `process.chdir(os.tmpdir())`.
- [ ] **Step 3: Run** `pnpm check && pnpm build`. Expected: PASS, same test count + 1.
- [ ] **Step 4:** Commit `refactor: extract application, adapters, database and testing packages`.

### Task 29: `apps/api`

**Files:**

- Move: `src/app/api/**` → `apps/api/app/api/**`; `tests/integration/**` → `apps/api/tests/integration/**`
- Create: `apps/api/{package.json, next.config.ts, tsconfig.json, app/layout.tsx}` (minimal root layout required by Next; the API serves no pages)
- Config: `output: "standalone"`, `outputFileTracingRoot` and `turbopack.root` = repo root, `poweredByHeader: false`, `transpilePackages: ["@ros/*" …]`.

- [ ] **Step 1:** Move the files and wire `package.json` scripts (`dev -p 4000`, `build`, `start`, `test`).
- [ ] **Step 2: Run** `pnpm --filter @ros/api test`. Expected: every integration test passes, with the same count.
- [ ] **Step 3: Run** `pnpm --filter @ros/api build && node apps/api/.next/standalone/apps/api/server.js` (with `PORT=4000`), then `curl -s localhost:4000/api/v1/health`. Expected: `{"data":{"status":"ok",…}}`.
- [ ] **Step 4:** Commit `refactor: api as its own deployable Next.js app`.

### Task 30: `apps/console`, `apps/ops`, `apps/admin` with a runtime API proxy

**Files:**

- Create: `packages/ui`, `packages/web-core`, `packages/api-client` (moves per the mapping table); `apps/{console,ops,admin}/{package.json,next.config.ts,tsconfig.json,proxy.ts,app/**}`; `packages/web-core/src/api-proxy.ts`, `packages/web-core/src/api-proxy.test.ts`; in each frontend, `app/api/v1/[...path]/route.ts` (one line re-exporting the proxy handlers); `app/healthz/route.ts`
- Move: routes per the ownership list; `public/` assets copied to each app that uses them; `src/proxy.ts` matcher split per app (console `/app/:path*`; ops `/waiter|kitchen|cashier/:path*`; admin `/admin/:path*`)

**Interfaces:**

- `createApiProxy(cfg: { apiInternalUrl: () => string }): { GET; POST; PUT; PATCH; DELETE }`. The URL is read from `process.env.API_INTERNAL_URL` at request time, never at build time.
  - Forwards: method, path and query, body stream (`duplex: "half"`), `cookie`, `content-type`, `idempotency-key`, `origin`, `sec-fetch-site`, `user-agent`, `x-request-id`, `x-forwarded-for`.
  - Sets `x-forwarded-host`.
  - Streams the response body back unbuffered, with every `set-cookie` header (via `headers.getSetCookie()`).
  - Adds `x-accel-buffering: no` for `text/event-stream`.
  - Upstream failure → 502 `{ error: { code: "INTERNAL_ERROR", message: "API unavailable" } }`.
- Each frontend app `next.config.ts`: `output: "standalone"`, tracing root, `transpilePackages`, `SECURITY_HEADERS` (moved to `@ros/web-core`). Ops and console keep Serwist; admin has none.
- Cross-app links in the profile menu use `CONSOLE_URL`, `OPS_URL` and `ADMIN_URL`, exposed through a server component reading runtime env (no `NEXT_PUBLIC_` build-time baking).

- [ ] **Step 1: Write failing tests** in `api-proxy.test.ts`, against a local `http.createServer` upstream:
  - `forwards cookies and returns all set-cookie headers`.
  - `streams SSE chunks without buffering`: the first chunk arrives before upstream closes, within 500 ms.
  - `passes request body and idempotency-key`.
  - `502 when upstream is down`.
  - `reads API_INTERNAL_URL at request time`.
- [ ] **Step 2: Run** `pnpm --filter @ros/web-core test`. Expected: FAIL.
- [ ] **Step 3: Implement** the proxy and move the UI.
- [ ] **Step 4:** Add a lint check: `pnpm turbo run lint` must fail if a frontend imports `@ros/application`, `@ros/adapters` or `@ros/database`. Verify with a temporary bad import, then remove it.
- [ ] **Step 5: Run** `pnpm turbo run typecheck lint test build`. Expected: PASS for all 4 apps and all packages.
- [ ] **Step 6:** Commit `refactor: console, ops and admin as separate apps behind a runtime API proxy`.

### Task 31: Dockerfiles, docker-compose and end-to-end verification

**Files:**

- Create: `infra/docker/next-app.Dockerfile`, `infra/docker/.dockerignore`, `infra/compose/docker-compose.yml`, `infra/compose/.env.compose.example`, `infra/compose/init-roles.sql`

**Interfaces:**

- Dockerfile with build arg `APP` ∈ `{api, console, ops, admin}`:
  - stage 1 `turbo prune @ros/$APP --docker`;
  - stage 2 `pnpm install --frozen-lockfile` and `turbo run build --filter=@ros/$APP`;
  - stage 3 `node:22-slim`, non-root user `app`, copies standalone, `.next/static` and `public`;
  - `HEALTHCHECK` curls `/api/v1/health` (api) or `/healthz` (frontends); `CMD node apps/$APP/server.js`.
- Compose services:
  - `postgres:18` and `minio/minio` (named volumes);
  - `migrate` (one-shot, runs the database package's migrate as owner);
  - `roles` (one-shot, `init-roles.sql`: `ALTER ROLE ros_runtime LOGIN PASSWORD :'pw'`, from env);
  - `api` (connects as `ros_runtime`, `REALTIME_PROVIDER=postgres`, `STORAGE_PROVIDER=s3`, `TRUSTED_PROXY_HOPS=1`, `ALLOWED_ORIGINS` = the three frontend origins);
  - `console` :3000, `ops` :3001, `admin` :3002, each with `API_INTERNAL_URL=http://api:4000`.

- [ ] **Step 1:** Build each image: `docker build -f infra/docker/next-app.Dockerfile --build-arg APP=<app> -t ros-<app>:local .`. Expected: 4 images, each under 300 MB (`docker images ros-*`).
- [ ] **Step 2:** `docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose.example up -d`, then `docker compose ps`. Expected: all services healthy and migrate/roles exited 0.
- [ ] **Step 3:** `pnpm smoke --base-url http://localhost:3000`. Expected: PASS (proves proxy, cookies, RLS as `ros_runtime`, S3 uploads, realtime).
- [ ] **Step 4: SSE spike.** Open `curl -N -b <cookie> http://localhost:3001/api/v1/branches/<id>/events` and place an order through the console. Expected: an event line arrives in under 2 s. Record the result in the task report.
- [ ] **Step 5:** Run Playwright against compose: `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 6:** Prove independent deployability. Change a string in `apps/admin`, rebuild only `ros-admin`, and run `docker compose up -d admin`. The other containers keep their uptime (`docker compose ps`). Revert the string.
- [ ] **Step 7:** `docker compose down` (volumes kept). Commit `build: per-app Docker images and docker-compose stack`.

### Task 32: Per-app CI

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- `verify` runs `turbo run typecheck lint test build --filter=...[origin/main]`, so only affected packages and apps run.
- `integration-pg` uses service `postgres:18` and runs RLS role tests and the realtime adapter with `PG_TEST_URL`.
- `storage-s3` uses service `minio` and runs the S3 contract.
- `images` is a matrix over the 4 apps: `docker build` with no push. Each runs only when that app's turbo graph is affected.

- [ ] **Step 1:** Write the jobs and validate locally with `pnpm dlx @action-validator/cli .github/workflows/ci.yml`. Expected: no errors.
- [ ] **Step 2:** Commit `ci: affected-only builds, Postgres 18 and MinIO jobs, per-app images`.
- [ ] **Step 3: [OWNER APPROVAL]** Push so CI runs.

## Phase 5 — Clean-up and documentation

### Task 33: Comment clean-up

**Files:** all TypeScript under `apps/` and `packages/`

- [ ] **Step 1:** Measure the baseline: `grep -rE "^\s*(//|/\*|\*)" --include=*.ts --include=*.tsx apps packages | wc -l`. Record it (2,417 at `02e5eeb`).
- [ ] **Step 2:** One package or app per commit, remove comments that restate the code. Keep:
  - comments giving a non-obvious reason;
  - port and interface docs that state contracts (for example `RealtimeEvent`, `TransactionRunner`);
  - security rationale (CSRF, RLS, allow-list reasons).
- [ ] **Step 3:** After each commit run `pnpm turbo run typecheck lint test`. Expected: PASS, with zero non-comment lines changed (`git diff --stat -w` and `git diff | grep '^[-+]' | grep -vE '^\s*[-+]\s*(//|/\*|\*)'` show only comment lines).
- [ ] **Step 4:** Report the before/after counts in the final commit message `chore: remove comments that restate code`.

### Task 34: Documentation and runbooks; apply migrations to the real local data

**Files:**

- Modify: `README.md`, `docs/architecture.md`, `docs/environment-variables.md`, `docs/tenant-security.md`, `docs/provider-abstractions.md`, `docs/provider-migration-guide.md`, `docs/deployment.md`, `docs/testing.md`, `docs/database-schema.md`, `docs/implementation-roadmap.md`
- Create: `docs/runbooks/backup-and-restore.md`, `docs/runbooks/rollback.md`, `docs/runbooks/local-data-preservation.md`, `docs/runbooks/disable-rls-emergency.md`

- [ ] **Step 1:** Update the docs for the monorepo layout and for every new env var:
  - `TRUSTED_PROXY_HOPS`, `DATABASE_TENANT_ROLE`, `ALLOWED_ORIGINS`, `QR_BASE_URL`;
  - `S3_FORCE_PATH_STYLE`, `REALTIME_PROVIDER=postgres`;
  - `API_INTERNAL_URL`, `CONSOLE_URL`, `OPS_URL`, `ADMIN_URL`, `APP_VERSION`.
    Also cover the RLS model, organization billing, the fair-use settings and the compose stack.
- [ ] **Step 2:** Write the runbooks. Each has exact commands copied from Tasks 1, 25 and 31, and from spec §10.
- [ ] **Step 3: [OWNER APPROVAL] Apply migrations 0002–0004 to the real `.data/pglite`:**
  - Show the owner the Task 25 rehearsal result first.
  - Run `pnpm db:snapshot` (a fresh snapshot), then `pnpm db:migrate`.
  - Then `pnpm db:verify` against the fresh snapshot's manifest for pre-existing tables, and `pnpm smoke` against `pnpm dev`.
  - Expected: counts identical, smoke PASS. On any failure stop. The snapshot is the restore point: `mv` the failed dir aside (do not delete it) and copy the snapshot back.
- [ ] **Step 4:** Run `pnpm turbo run typecheck lint test build`. Expected: PASS. Commit `docs: monorepo layout, security model, runbooks`.

---

## Added scope (owner, 2026-11-07): offline-first and clean-up

### Task 35: Offline-first gaps (IndexedDB outbox, Postgres authoritative)

Runs after Phase 3 and before Phase 4. The offline layer in `src/features/offline` (Dexie `restaurantos-staff`, FIFO-per-scope sync engine, backoff, idempotency keys, conflict states, Web Lock, crash recovery) is kept. `docs/offline-sync.md` describes it. This task closes the gaps without ever showing a server-dependent result as confirmed.

**Files:**

- Modify: `src/features/offline/{db.ts,sync-engine.ts,runtime.ts,index.ts}`, `src/features/kitchen/kitchen-display.tsx`, `src/features/waiter/waiter-console.tsx`, the staff-order compose UI, `src/server/modules/staff-ops/service.ts` (only if `expectedVersion` is missing on item-status/transition endpoints), `src/contracts/staff-ops.ts`, `docs/offline-sync.md`
- Create: `tests/e2e/offline.spec.ts`, and new unit tests next to `sync-engine.test.ts`

**Interfaces:**

- Kitchen item-status changes and order transitions (start, ready) are queued with `enqueueMutation`:
  - scope `order:<orderId>`, carrying `expectedVersion`;
  - a `409 INVALID_STATE_TRANSITION`/`STALE_VERSION` becomes `conflict`;
  - the UI badge reads "Waiting to sync", never "Ready".
- Staff-entered orders (`POST /branches/:id/orders`) are queued:
  - scope `table:<tableId>`, using the body's existing `idempotencyKey`, generated once per draft and reused on every retry;
  - the UI shows "Not sent — will send when online" and never "Sent to kitchen" until a 2xx;
  - a 201/200 replay settles it; prices always come from the server response.
- Never queued, unchanged: order accept/reject, bill generation, payments, refunds, session close, guest ordering. These buttons are disabled offline with the reason shown.
- The Dexie schema bumps to version 2 only if new indexes are needed. The upgrade keeps every existing outbox row.

- [ ] **Step 1: Write failing unit tests:**
  - `queued kitchen status uses expectedVersion and maps 409 to conflict`.
  - `staff order retry reuses the same idempotencyKey`.
  - `offline staff order is never marked synced without 2xx`.
  - `dexie v1→v2 upgrade keeps pending items`.
- [ ] **Step 2: Write the failing Playwright test** `offline.spec.ts`, using `context.setOffline(true)`:
  - The waiter composes an order offline; the UI shows "Not sent".
  - Go back online; the order reaches the kitchen feed exactly once.
  - The kitchen marks an item ready offline, then goes online; the status syncs.
  - Payments and accept buttons are disabled offline.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm vitest run src/features/offline` and `pnpm build && pnpm test:e2e tests/e2e/offline.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Update `docs/offline-sync.md` (the per-role table). Commit `feat(offline): queue kitchen status and staff orders with conflict handling`.

### Task 36: Clutter and duplication audit

Runs after Task 33, inside Phase 5.

- [ ] **Step 1: Inventory**, writing the result to the task report before deleting anything:
  - `pnpm dlx knip` (unused files, exports, dependencies);
  - `pnpm dlx jscpd apps packages --min-tokens 60` (duplicates);
  - `git ls-files` review for temp files.
  - Known at 2026-11-07: `tests/e2e/zz-shot-tmp.spec.ts` (screenshot scratch writing to another machine's `/tmp` path), and `tsconfig.analytics-check.json` (one-off typecheck config; delete if nothing references it).
- [ ] **Step 2:** Remove unused files and exports, and merge duplicates of three or more lines into shared helpers. Never touch migrations `0000`–`0004` or their `meta/` snapshots; they are the required history applied to the owner's data. Never delete `.data/` contents.
- [ ] **Step 3:** Run `pnpm turbo run typecheck lint test build` and the Playwright suite. Expected: PASS. Commit `chore: remove unused files, exports and duplicate code`.

## Approval gates in Phases 0–5 (summary)

| Step                          | Action                                        | Why approval                                   |
| ----------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Task 2 Step 7                 | Revoke the exposed sessions in `.data/pglite` | Modifies owner data (non-destructive `UPDATE`) |
| Task 2 Step 8                 | Git history rewrite (recommended: decline)    | Destructive on a public pushed branch          |
| Task 7 Step 5, Task 32 Step 3 | Push to GitHub                                | Outward-facing                                 |
| Task 34 Step 3                | Apply new migrations to `.data/pglite`        | Changes owner data (additive)                  |

Local Docker containers (`postgres:18`, `minio`) and new open-source dependencies (`turbo`, `@aws-sdk/client-s3`, `@electric-sql/pglite-tools`) are free and local. They are listed here so the owner approves them together with this plan.
