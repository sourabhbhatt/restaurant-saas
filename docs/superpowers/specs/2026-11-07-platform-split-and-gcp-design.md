# RestaurantOS: Monorepo split, subscription rules, GCP deployment and exit plan

Status: **architecture approved by owner 2026-11-07** with the decisions in §14. Implementation plan for Phases 0–5: `docs/superpowers/plans/2026-11-07-phases-0-5-security-tenancy-subscriptions-portability-monorepo.md`. Nothing in this document has been provisioned, deployed or migrated.
Date: 2026-11-07. GCP trial: standard $300 Free Trial, valid until **2027-02-26** (owner-stated). Google's docs describe the credit as 90 days; 90 days from today would be 2027-02-05. Confirm the exact end date in Billing → Overview before Gate G1; every date in §11 and §12 is computed from 2027-02-26 and shifts earlier if the console shows otherwise.

## 1. Goals and constraints

| #   | Requirement                                                  | Where addressed |
| --- | ------------------------------------------------------------ | --------------- |
| 1   | Verify trial eligibility, credit usage, monthly cost         | §3, §8          |
| 2   | Production-ready modular monorepo                            | §4              |
| 3   | Provider-independent database, auth, storage, infrastructure | §5              |
| 4   | Leave GCP without application rewrites                       | §5, §11         |
| 5   | Tenant isolation, RBAC, subscription enforcement             | §6, §7          |
| 6   | Pro trial 15 days, 7-day grace                               | §7              |
| 7   | Trial and Monthly: one workspace per organization            | §7              |
| 8   | Preserve all functionality and data                          | §9              |
| 9   | Automated backups, restore, rollback                         | §10             |
| 10  | Exit plan before trial expiry                                | §11             |

Hard constraints from the owner:

- No paid resources, deploys, data deletion or destructive migrations without explicit approval. Every such step is marked **[APPROVAL GATE]** in §12.
- No custom domain purchase. Google-provided URLs only.
- Clean code: comments only where they explain a non-obvious reason.

## 2. Audit of the current codebase (commit `02e5eeb`)

**Healthy**

- 368 tests passing across 44 files (Vitest, embedded Postgres via PGlite), measured 2026-11-07.
- Clean layering: `domain` (pure rules) → `contracts` (Zod) → `server` (services, ports, authz) → `infrastructure` (adapters). No UI file imports `server` or `infrastructure`; the UI talks only to `/api/v1`. This makes the split low-risk.
- `route()` (`src/server/http/route.ts`) uses web-standard `Request`/`Response` only, so the API is not tied to Next.js.
- Authentication is in-app (scrypt, hashed sessions); no auth vendor lock-in.
- Database access is plain Postgres via Drizzle; works on any Postgres 18.
- Tenant isolation at the application layer: server-resolved scopes, 404 across tenants, `workspace_id` on every tenant table, conditional updates, idempotency keys.

**Gaps that block a GCP deployment**

| Gap                                                                   | Impact on Cloud Run                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Storage provider is `local` only; the S3 adapter is not implemented   | Uploads lost on every Cloud Run revision (ephemeral disk)              |
| Realtime is an in-process memory bus                                  | With more than one instance, live updates degrade to polling           |
| CSRF check compares against a single `APP_URL`                        | Three frontends on three origins proxying to one API would be rejected |
| No Dockerfiles, no health endpoint, no CI                             | Nothing to deploy                                                      |
| Postgres Row-Level Security not enabled; app runs as the schema owner | One missing `WHERE workspace_id` would leak data; no second line       |

**Gaps against the business rules**

- Trial is 30 days on Pro (`DEFAULT_PLATFORM_SETTINGS.trialDays = 30`); reminder days `[7, 15, 25]`.
- No organization entity. The subscription belongs to a workspace, and a user can create unlimited workspaces, each with a fresh trial (trial abuse).
- Of the 10 plan features, five are enforced: `analytics`, `custom_roles`, `multi_branch` (via `assertFeature`), `qr_ordering` (ordering service) and `advanced_analytics` (in-body `ENTITLEMENT_REQUIRED` for branch comparison). `kitchen_display`, `offline_mode` and `email_notifications` are available regardless of plan; `push_notifications` uses a no-op sender; `data_export` has no implementation.

**Security vulnerabilities (fix first)**

| #   | Finding                                                                                                                                                                                                                | Severity                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| S1  | `n.jar`, `o.jar` hold live `ros_session` tokens; the GitHub repo is **public** and branch `claude/epic-turing-vhor3y` is pushed. Tokens are only valid against the local PGlite database, where they remain unrevoked. | High (exposure) / Low (reach) |
| S2  | `clientIp()` trusts the first `X-Forwarded-For` entry from any client. Every rate limit (sign-in, sign-up, reset, QR join, orders) is bypassed by sending a new random header per request.                             | High                          |
| S3  | Sign-in and forgot-password are throttled per IP only (no per-account bucket), so credential stuffing is unbounded once S2 is used.                                                                                    | High                          |
| S4  | Idempotent replays are returned before the handler authorizes, and the replay key is not bound to the caller. Anyone who learns a branch ID and an `Idempotency-Key` gets the stored response.                         | Medium                        |
| S5  | No database-level tenant isolation; the runtime connects as the schema owner (DDL rights).                                                                                                                             | Medium                        |
| S6  | No `Strict-Transport-Security`, no `Content-Security-Policy` (`frame-ancestors`, `object-src`, `base-uri`) or `Permissions-Policy` on pages.                                                                           | Low                           |
| S7  | With `DATABASE_PROVIDER=pglite`, every server start applies pending migrations to `.data/pglite` with no snapshot first.                                                                                               | Data-safety                   |

**Hygiene**

- `.data/` (58 MB local PGlite database) is untracked but not gitignored.
- 2,417 comment lines across 622 TypeScript files (76,520 lines). Many restate the code.

## 3. Google Cloud facts (verified 2026-11-07)

From [Google Cloud Free Program docs](https://docs.cloud.google.com/free/docs/free-cloud-features) and [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing):

- The $300 credit is valid for 90 days and covers Cloud SQL, Cloud Run and the other services used here, including usage above Free Tier limits.
- Trial-account restrictions that matter: no quota increases, no Marketplace, no GPUs, no Windows VMs. None block this design.
- At trial end, if not upgraded, the billing account closes and resources stop. There is a 30-day window to upgrade and recover; after that resources are permanently deleted. The trial cannot be paused or extended.
- Upgrading during the trial keeps the remaining credit until day 90; afterwards only usage above Free Tier is billed.
- Always Free (per billing account, per month): Cloud Run 2M requests, 180,000 vCPU-seconds, 360,000 GiB-seconds (request-based billing); Artifact Registry 0.5 GB; Secret Manager 6 active versions and 10,000 accesses; Cloud Build 2,500 build-minutes; Cloud Scheduler 3 jobs ($0.10 per extra job). Cloud Storage free tier applies to US regions only.
- **Cloud SQL has no Always Free tier.** It is paid from the credit.

Partially verified: Cloud SQL list price for `db-g1-small` is about $0.035/hour and `db-f1-micro` about $0.0105/hour; neither is covered by the Cloud SQL SLA ([Cloud SQL pricing](https://cloud.google.com/sql/pricing)). Recent Cloud Run docs list `asia-south1` under Tier 1; older pages say Tier 2.

Database major version: **PostgreSQL 18**. The local data lives in PGlite 0.5.15, which is PostgreSQL 18.6, and `pg_dump` output is not guaranteed to restore into an older major version. Cloud SQL for PostgreSQL 18 has been GA since 2025-12-16 and is the default major version ([release notes](https://docs.cloud.google.com/sql/docs/postgres/release-notes), [versions](https://docs.cloud.google.com/sql/docs/postgres/db-versions)). Docker, CI and the exit targets use `postgres:18`.

Not verified (regional rates did not load for automated reading; must be confirmed in the [pricing calculator](https://cloud.google.com/products/calculator) with region `asia-south1` before provisioning): Cloud SQL Mumbai prices, Cloud Run Mumbai tier, whether Cloud Run's free tier applies in `asia-south1`. Cost figures in §8 that depend on these are estimates.

## 4. Target architecture: modular monorepo

One repository, one lockfile, one source of truth for business rules and contracts. Four deployable apps, shared packages. pnpm workspaces + Turborepo for task orchestration and caching.

```
apps/
  api/        HTTP API (/api/v1). Route handlers + composition root. No UI.
  console/    Public site, sign-up/sign-in, onboarding, owner/manager dashboard, customer QR pages (/t/<token>)
  ops/        Waiter, kitchen, cashier. PWA with offline outbox.
  admin/      Super Admin console.
packages/
  domain/          Pure business rules (money, pricing, orders, billing, entitlements, permissions). No I/O.
  contracts/       Zod schemas and DTO types shared by API and UIs.
  application/     Services, ports, authz, HTTP wrapper (today's src/server minus composition).
  adapters/        Provider implementations (postgres, s3, local storage, email, realtime, logging).
  database/        Drizzle schema, migrations, system data, migrate/seed CLIs.
  api-client/      Typed fetch client used by all three UIs.
  ui/              Design system, layouts, shared feedback, profile menu.
  web-core/        Shared client plumbing: query client, offline cache, auth gate, sync engine.
  tooling/         Shared tsconfig, ESLint, Prettier configs.
infra/
  docker/          One Dockerfile per app (multi-stage, Next.js standalone output).
  compose/         docker-compose.yml: Postgres 18 + MinIO + all apps. Used for local parity and as the VPS exit target.
  gcp/             Idempotent gcloud scripts: bootstrap, deploy, backup, restore, teardown.
```

Dependency rules (enforced by ESLint `no-restricted-imports` and package `exports`):

1. `apps/console|ops|admin` → `ui`, `web-core`, `api-client`, `contracts`, `domain`. Never `application`, `adapters`, `database`.
2. `apps/api` → `application`, `adapters`, `database`, `contracts`, `domain`. It is the only composition root.
3. `application` → `domain`, `contracts`, ports only. Never `adapters`.
4. `domain` depends on nothing.

**API runtime.** Phase 1 keeps the API as a Next.js app containing only route handlers, so all 368 tests and every handler move unchanged. Because `route()` is web-standard, a later swap to a plain Node server (Hono) is a contained change; it is not part of this plan.

**One sign-in per app.** `*.run.app` is on the Public Suffix List, so cookies cannot be shared across the three URLs. Each frontend proxies `/api/v1/*` to the API (Next.js rewrites to `API_INTERNAL_URL`), keeping the session cookie first-party on each origin and avoiding third-party-cookie blocking. Consequences:

- A user signs in separately on Console, Ops and Admin. Each session is an ordinary row in `sessions`.
- The API accepts mutations from an allow-list `ALLOWED_ORIGINS` (the three frontend origins) instead of one `APP_URL`, and trusts `X-Forwarded-For` only from the proxy.
- SSE streams through the proxy; a spike in Phase 2 confirms Next.js rewrites do not buffer the stream. Fallback: polling, which already exists.

**Who uses which app**

| App     | Users                                                                               | URL (GCP)                              |
| ------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| console | Visitors, owners, admins, managers, guests via QR                                   | `https://ros-console-<hash>.a.run.app` |
| ops     | Waiter, kitchen, cashier                                                            | `https://ros-ops-<hash>.a.run.app`     |
| admin   | Platform Super Admin                                                                | `https://ros-admin-<hash>.a.run.app`   |
| api     | Called only by the three frontends (ingress: all, but no browser calls it directly) | `https://ros-api-<hash>.a.run.app`     |

**Stable QR links without buying a domain.** Printed table QR codes encode a URL. If that URL is `*.run.app`, every provider move forces reprinting every QR code. Instead, QR codes point to a free Firebase Hosting site on the Spark plan (`https://<project>.web.app/t/<token>`, no billing account needed) whose only job is a 302 redirect to the current Console URL. Moving providers means editing one redirect rule. New env var `QR_BASE_URL` separates the QR host from `APP_URL`.

## 5. Provider independence

Every provider sits behind a port in `packages/application/ports` and is selected by environment variables in `apps/api`. Moving providers is a configuration change plus a data copy.

| Concern  | Port                 | GCP choice                                   | Portable because                                                     | Alternatives (env change only)                 |
| -------- | -------------------- | -------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| Database | Drizzle + `pg`       | Cloud SQL PostgreSQL 18, `asia-south1`       | Standard `DATABASE_URL`; no Cloud SQL-specific SQL or extensions     | Neon, Supabase, any Postgres 18, self-hosted   |
| Auth     | `IdentityProvider`   | In-app (existing)                            | Users, sessions and hashes live in our own tables                    | Unchanged anywhere                             |
| Storage  | `ObjectStorage`      | Cloud Storage via S3 interoperability (HMAC) | New generic S3 adapter (`@aws-sdk/client-s3`), endpoint configurable | Cloudflare R2, Backblaze B2, MinIO, AWS S3     |
| Realtime | `RealtimeBus`        | New Postgres `LISTEN/NOTIFY` adapter         | Runs on the database we already have; works with multiple instances  | Same adapter on any Postgres; `memory` locally |
| Email    | `EmailSender`        | Resend or Brevo (existing adapters)          | HTTP APIs, no GCP dependency                                         | Any SMTP/HTTP sender                           |
| Jobs     | HTTP + `CRON_SECRET` | Cloud Scheduler → `POST /api/v1/jobs/*`      | Any cron can call an authenticated URL                               | GitHub Actions cron, system cron               |
| Secrets  | Environment vars     | Secret Manager mounted as env vars           | App only reads env vars                                              | `.env` file, Render/Fly secrets                |
| Runtime  | Docker image         | Cloud Run                                    | Same images run under docker-compose on any VM                       | Any container host                             |
| Logs     | `Logger`             | JSON to stdout → Cloud Logging               | stdout is universal                                                  | Any log collector                              |

No GCP SDK is imported by application code. GCP-specific knowledge lives only in `infra/gcp/`.

## 6. Tenant isolation and RBAC

Keep everything that exists (server-resolved scopes, permission checks per level, 404 across tenants, Super Admin separated on `/api/v1/admin/*`). Add database-level defence:

1. Three database roles:
   - `ros_owner` owns the schema and runs migrations.
   - `ros_runtime` is the login the apps use: DML only, no DDL, not the owner.
   - `ros_tenant` (NOLOGIN) is the role tenant transactions switch into; `ros_runtime` is a member.
     No role needs `BYPASSRLS` or superuser, so this works on Cloud SQL and any managed Postgres.
2. `ENABLE ROW LEVEL SECURITY` (not `FORCE`) on every table with `workspace_id`. Policies are per role:
   - `tenant_isolation TO ros_tenant` uses `workspace_id = app_current_workspace()`.
   - `runtime_access TO ros_runtime` uses `true`.
   - The owner bypasses RLS because the tables aren't forced.
   - `workspace_memberships` and `notifications` also match `user_id = app_current_user()`.
   - `roles` also lets system roles (`workspace_id IS NULL`) be read.
3. A request-scoped context (AsyncLocalStorage) records the workspace once the access service has verified membership. The tenant transaction runner runs every `run` **and** `read` inside a transaction that does `SET LOCAL ROLE ros_tenant` and `set_config('app.workspace_id' | 'app.user_id', …, true)`. With no context bound it fails closed.
4. System paths run as `ros_runtime` through an explicitly named system runner, on an allow-list checked by a test: authentication/sessions, the authorization lookup itself, entitlement resolution, QR/guest token lookup, scheduled jobs, the Super Admin console, rate limit/idempotency/outbox.
5. Verified 2026-11-07: PGlite enforces RLS after `SET LOCAL ROLE` (scoped query sees its own rows, unscoped sees none, superuser sees all). The integration suite therefore runs with RLS on, with no Docker needed. CI adds a Postgres 18 service job for the role/grant behaviour PGlite cannot reproduce.

Super Admin capabilities (existing plus new): create organizations, create workspaces inside an organization, assign an owner, change plan or billing cycle, grant entitlement overrides (including `maxWorkspaces`), suspend/reactivate, approve upgrade requests. Every action is audited, as today.

## 7. Subscription model changes

### 7.1 Organization becomes the billing owner

New hierarchy:

```
Organization ──< Workspace ──< Restaurant ──< Branch
     │
     └── Subscription (plan, billing cycle, status, trial dates)
```

- `organizations` table: `id, name, created_by, status, timestamps`. `organization_members`: owner/billing-admin roles at organization level.
- `workspaces.organization_id` (NOT NULL after backfill).
- `subscriptions.organization_id` replaces `subscriptions.workspace_id` (expand/contract, §9.2). Entitlements are resolved per organization and apply to all its workspaces.
- Sign-up creates an organization and its first workspace in one transaction and starts the trial on the organization. A user who already owns a trialing organization cannot start another trial (closes the abuse gap).

### 7.2 Workspace limit

New limit key `maxWorkspaces` in `PlanLimits`. Rule in `packages/domain/subscriptions`:

```
effectiveMaxWorkspaces =
  phase is TRIAL or GRACE      → 1
  billingCycle is MONTHLY      → 1
  otherwise                    → plan.limits.maxWorkspaces (null = unlimited)
  then Super Admin override `maxWorkspaces`, if present, wins
```

Default plan data: Starter `maxWorkspaces: 1`; Pro `maxWorkspaces: 3` (only reachable on Annual); Enterprise `null` (unlimited, subject to fair use).

Enterprise fair-use safeguards (platform settings, editable by Super Admin):

- `fairUseMaxWorkspaces: 25`: an "unlimited" organization may hold at most this many workspaces unless a Super Admin sets a per-organization override.
- `workspaceCreatesPerDay: 5`: at most this many new workspaces per organization in any rolling 24 hours, for every plan.
- Reaching either returns `LIMIT_REACHED` with a "contact support" hint, and writes an audit entry `organization.fair_use_limit_hit`. Creating a workspace beyond the limit returns `LIMIT_REACHED` with an upgrade hint. Existing organizations already above the limit keep their workspaces (no deletion); they cannot add more.

### 7.3 Trial and grace

- `trialDays: 15`, `graceDays: 7` (unchanged), `trialPlanKey: "pro"` (unchanged).
- Reminder days change from `[7, 15, 25]` to `[7, 12, 14]` (day 25 would never fire in a 15-day trial).
- `ensureSystemData` only inserts missing settings, so a data migration updates the stored `trialDays` row from 30 to 15 **only if it still equals the old default** (a value edited by Super Admin is kept).
- Trials already running keep their current end dates. New trials get 15 days.
- Timeline: day 0–15 FULL; day 15–22 GRACE (operations continue, growth blocked); after day 22 READ_ONLY (settle open bills only). This logic exists and is tested; only the numbers change.

### 7.4 Feature flags that do nothing today

- Enforce `kitchen_display`: kitchen feed, kitchen item-status changes and the kitchen event stream.
- `offline_mode` and `email_notifications` stay ungated because they are core: an offline outbox protects order data, and account and security emails must always send. Both are marked _not advertised_, not deleted, so stored plan JSON stays valid.
- `push_notifications` and `data_export` are marked _not advertised_ until implemented.
- The pricing page and the Super Admin plan editor list only advertised features. A test fails if any advertised feature has no enforcement call site.

## 8. Cost breakdown (estimates; confirm in the pricing calculator before Gate G2)

Region `asia-south1` for everything except the Firebase redirect site. Currency USD; ₹ at ≈ 84/$.

**Pilot configuration (recommended during the trial)**

| Item                           | Configuration                                                     | Est. monthly       | Basis                                                      |
| ------------------------------ | ----------------------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Cloud SQL PostgreSQL 18        | Enterprise, `db-g1-small` (shared core, 1.7 GB), 10 GB SSD, no HA | $30–38             | ~$26 us-central1 list + storage; Mumbai premium unverified |
| Cloud SQL backups              | 7 automated daily + PITR (7 days of WAL)                          | $1–3               | Backup storage per GB                                      |
| Cloud Run (4 services)         | min instances 0, max 2, 1 vCPU / 512 MiB, request-based           | $0–5               | Pilot traffic fits the 2M request free tier                |
| Cloud Run API warm instance    | Optional: API `min-instances=1` to avoid cold starts in kitchens  | $8–15              | Idle instance pricing; unverified                          |
| Artifact Registry              | 4 images, keep last 3 each (cleanup policy)                       | $0–0.50            | 0.5 GB free, then per GB                                   |
| Cloud Storage                  | Standard, Mumbai, < 5 GB uploads + < 5 GB DB dumps                | $0.20–0.50         | Free tier is US-only                                       |
| Secret Manager                 | ~8 secrets                                                        | $0–0.20            | 6 versions free                                            |
| Cloud Scheduler                | 2 jobs (subscription sweep, nightly logical backup)               | $0                 | 3 jobs free                                                |
| Cloud Build                    | Image builds                                                      | $0                 | 2,500 min free                                             |
| Logging, egress                | Pilot volumes                                                     | $0–2               | 50 GiB logs free per project                               |
| Firebase Hosting (QR redirect) | Spark plan                                                        | $0                 | No billing account                                         |
| **Total**                      |                                                                   | **$40–65 / month** | ≈ ₹3,400–5,500                                             |

Trial usage: resources are created only after Phases 0–5 (est. early December 2026), so they run about 12 weeks to 2027-02-26: roughly $110–180 of the $300 credit. Even if everything ran from today (≈ 16 weeks), the total stays near $160–240. Leaves headroom for a one-time upgrade to `db-custom-1-3840` (dedicated 1 vCPU, 3.75 GB, covered by the Cloud SQL SLA; shared-core instances are not) at roughly $55–70/month if load testing shows the shared core is too small.

**After the trial on GCP (paid account)**: the same configuration at $40–65/month, or $65–95/month with the dedicated database. Regional HA for Cloud SQL roughly doubles the database line.

**Cost guardrails (part of Gate G1)**: billing budget with email alerts at 25%, 50%, 75%, 100% of $150; Cloud Run `max-instances` caps on every service; Artifact Registry cleanup policy; Cloud SQL storage auto-increase capped at 20 GB.

## 9. Migration plan

### 9.1 Code migration (no cloud, no data risk)

Done on a feature branch in small, independently reviewable steps. Each step must keep `pnpm check` (typecheck, lint, format, all tests) and every app's production build green before the next step starts.

1. Create the workspace skeleton (`apps/*`, `packages/*`, Turborepo) and move `domain` and `contracts` first; update import aliases mechanically.
2. Move `server` → `packages/application`, `infrastructure` → `packages/adapters` + `packages/database`.
3. Move `src/app/api` → `apps/api`; integration tests move with it.
4. Split UI routes: `(public)`, `(auth)`, `/app`, `/t`, `/print` → `console`; `/waiter`, `/kitchen`, `/cashier` → `ops`; `/admin` → `admin`. Shared UI → `packages/ui` and `packages/web-core`.
5. Add proxy rewrites, `ALLOWED_ORIGINS`, health endpoints, Dockerfiles, docker-compose.
6. Behaviour check: the existing headless-browser walkthrough and the order-to-payment HTTP run, executed against docker-compose.

Rollback: the branch is merged only when green; reverting the merge commit restores the single app.

### 9.2 Schema migration (expand → backfill → contract)

All migrations are additive until the contract step, so any intermediate deploy can be rolled back to the previous release without data loss.

| Step     | Migration                                                                                                                                  | Reversible by                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Expand   | Create `organizations`, `organization_members`; add nullable `workspaces.organization_id`, `subscriptions.organization_id`                 | Previous release ignores new columns                     |
| Backfill | One organization per existing workspace (name = workspace name, owner = workspace owner); copy `subscriptions.workspace_id` → organization | Idempotent; rerunnable                                   |
| Switch   | Release that reads and writes organization IDs; both columns kept in sync                                                                  | Redeploy previous revision                               |
| Verify   | Row counts, every workspace has an organization, every organization has exactly one current subscription                                   | —                                                        |
| Contract | `NOT NULL` on `organization_id`; drop `subscriptions.workspace_id` **[APPROVAL GATE]**                                                     | Restore from pre-contract backup                         |
| Settings | `trialDays` 30 → 15 and reminders, only where still default                                                                                | Update the row back                                      |
| RLS      | Create `ros_tenant` and `ros_runtime` roles, enable policies                                                                               | Down script: drop policies, `DISABLE ROW LEVEL SECURITY` |

### 9.3 Data migration: local → Cloud SQL **[APPROVAL GATE]**

The only existing data is the local PGlite database in `.data/pglite` (58 MB). **Owner decision: preserve and carry it over (option B).** Before any new migration touches it, Phase 0 takes a byte-for-byte snapshot that is never modified.

- **B. Carry the data over** (selected): export PGlite with `pg_dump` (via `@electric-sql/pglite-tools`), restore into Cloud SQL as `ros_owner`, run pending migrations, verify per-table row counts against the source, run the smoke suite. The local copy is never modified or deleted.

## 10. Backups, restore and rollback

**Backups**

- Cloud SQL automated backups daily at 02:00 IST, 7 retained; point-in-time recovery with 7 days of WAL.
- Nightly logical backup: a Cloud Run Job runs `pg_dump --format=custom` and writes `gs://<bucket>-backups/db/YYYY-MM-DD.dump`. Bucket lifecycle: 30 days retention. This dump is provider-neutral and is the exit artifact.
- Uploads bucket: object versioning on, noncurrent versions kept 30 days.
- On-demand Cloud SQL backup before every migration (scripted into `infra/gcp/deploy.sh`).

**Restore procedures** (scripted in `infra/gcp/`, documented in `docs/runbooks/`)

- Point-in-time: clone the instance to a timestamp, verify, switch `DATABASE_URL` secret, redeploy API.
- Logical: `pg_restore --no-owner --role=ros_owner -d <target>` into any Postgres 18, then `db:migrate`.
- Monthly restore drill into a temporary database, with row-count comparison; the temporary instance is deleted afterwards (approval each time it runs on a billed instance).

**Rollback**

| Failure                          | Action                                                              | Time      |
| -------------------------------- | ------------------------------------------------------------------- | --------- |
| Bad application release          | `gcloud run services update-traffic --to-revisions=<previous>=100`  | < 1 min   |
| Bad additive migration           | Redeploy previous revision (old code ignores new columns)           | < 5 min   |
| Bad contract migration / data    | PITR clone to just before the migration, switch secret, redeploy    | 15–30 min |
| GCP unavailable or account issue | Restore latest logical dump on the exit target, repoint QR redirect | 1–3 h     |

## 11. Exit plan (decide by 2027-01-27, complete by 2027-02-19)

Trial ends 2027-02-26. Decision point 30 days before (2027-01-27); migration, if any, finished by 2027-02-19 to keep a week of slack before resources stop. If the console shows an earlier end date, both dates move back by the same amount.

| Option                      | Setup                                                                                        | Monthly cost                     | Trade-off                                                             | Migration effort           |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| 1. Stay on GCP              | Upgrade billing account to paid; nothing changes                                             | $40–95                           | Easiest; managed DB in Mumbai                                         | None                       |
| 2. Single VPS               | docker-compose (Postgres 18, MinIO or R2, 4 apps, Caddy) on a small VM in India or Singapore | ~$6–15                           | Self-managed patching and backups                                     | ~1 day, 15–30 min downtime |
| 3. Oracle Cloud Always Free | Same docker-compose on an Arm VM in Mumbai                                                   | $0                               | Free capacity is often unavailable; idle-reclaim policy; self-managed | ~1 day, 15–30 min downtime |
| 4. Managed free tiers       | Neon or Supabase (Postgres) + Render or Koyeb (containers) + Cloudflare R2                   | $0 (limits, sleeps) to ~$45 paid | Sleep on idle, storage caps; not for live restaurants on free         | ~1 day                     |

Third-party prices and limits above are from earlier research (`docs/technology-decisions.md`) and memory; they are **re-verified at the 2027-01-27 decision point**.

Migration procedure for options 2–4 (no application change):

1. Provision target; set the same env vars (`DATABASE_URL`, `S3_*`, `ALLOWED_ORIGINS`, `APP_URL`, `QR_BASE_URL`, secrets).
2. Freeze writes: Super Admin enables maintenance mode (new platform setting; API returns 503 for mutations).
3. Final `pg_dump` → `pg_restore` to target; `rclone sync` uploads bucket to target bucket.
4. Start apps; run smoke suite; compare row counts.
5. Update the Firebase redirect so QR codes resolve to the new Console URL. Staff bookmark the new Ops URL.
6. Keep GCP running read-only for 7 days, then delete **[APPROVAL GATE]**.

Data egress cost for leaving GCP at pilot size: under $1.

## 12. Roadmap

| Phase                                                  | Work | Cloud resources | Gate |
| ------------------------------------------------------ | ---- | --------------- | ---- |
| Order follows the owner's priorities (security first). |

| Phase | Work                                                                                                                                                                                                     | Cloud resources    | Gate                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| 0     | Security fixes S1–S4, S6, S7: local data snapshot, cookie jars out of git and sessions revoked, trusted-proxy IP, per-account throttling, actor-bound idempotency, security headers, CI with secret scan | None               | Plan approval; session revocation and any history rewrite separately |
| 1     | Tenant isolation (S5): request context, tenant/system runners, RLS migration, isolation and RBAC test suites                                                                                             | None               | —                                                                    |
| 2     | Subscription changes (§7): organizations (expand/backfill/switch), workspace limits and fair use, 15-day trial, reminders, feature gating, tests                                                         | None               | —                                                                    |
| 3     | Provider independence: S3 adapter, Postgres realtime adapter, `ALLOWED_ORIGINS`, `QR_BASE_URL`, health checks, maintenance mode, provider-neutral dump/restore/verify                                    | None               | —                                                                    |
| 4     | Monorepo split (§9.1), proxy rewrites, SSE spike, Dockerfiles, docker-compose, per-app CI                                                                                                                | None               | —                                                                    |
| 5     | Comment cleanup; docs and runbooks updated to the new layout                                                                                                                                             | None               | —                                                                    |
| 6     | **G1:** GCP project, enable APIs, billing budget and alerts, Artifact Registry, Secret Manager, Firebase Hosting redirect site                                                                           | Free or near-free  | **Approval**                                                         |
| 7     | **G2:** Cloud SQL instance, buckets, Cloud Run services, Scheduler jobs, backup job (confirm prices in calculator first)                                                                                 | Billed from credit | **Approval**                                                         |
| 8     | **G3:** Data migration (§9.3 option A or B) and first production deploy                                                                                                                                  | —                  | **Approval**                                                         |
| 9     | Restore drill, rollback rehearsal (revision rollback, PITR clone)                                                                                                                                        | Temporary clone    | **Approval** per drill                                               |
| 10    | **G4:** Contract migration (drop `subscriptions.workspace_id`)                                                                                                                                           | —                  | **Approval**                                                         |
| 11    | Exit decision on 2027-01-27; execute by 2027-02-19                                                                                                                                                       | Depends            | **Approval**                                                         |

Phases 0–5 happen entirely in the repository and cost nothing.

## 13. Risks

| Risk                                                      | Likelihood | Mitigation                                                                 |
| --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| Credit runs out or trial lapses and resources are deleted | Medium     | Budget alerts; exit decision on day 60; nightly provider-neutral dumps     |
| Mumbai prices higher than estimated                       | Medium     | Confirm in calculator before G2; shared-core instance; caps on Cloud Run   |
| Shared-core Cloud SQL too small or affected by no-SLA     | Medium     | Load test in Phase 8; upgrade to `db-custom-1-3840` in place               |
| Cold starts slow the kitchen display                      | Medium     | Optional API warm instance; ops app is a PWA with cached shell and polling |
| SSE through the Next.js proxy is buffered                 | Low–Med    | Spike in Phase 2; fallback to polling (already implemented)                |
| Monorepo move breaks something not covered by tests       | Medium     | Small steps, green `pnpm check` per step, browser walkthrough before merge |
| RLS blocks a legitimate path (sign-in, QR lookup, jobs)   | Medium     | Explicit list of unscoped paths; tests on real Postgres; disable script    |
| Organization backfill wrong for multi-owner workspaces    | Low        | Verification queries before switch; contract step gated                    |
| `run.app` URLs change on provider move                    | Certain    | QR codes use the Firebase redirect host; staff URLs are bookmarks          |
| Separate sign-in per app annoys users with several roles  | Low        | Profile menu links to other apps; sessions last 30 days                    |

## 14. Owner decisions (2026-11-07)

1. Organization-level billing.
2. Pro Annual: 3 workspaces.
3. Enterprise: unlimited workspaces with fair-use safeguards (§7.2).
4. Existing trials keep their current end dates.
5. All existing local data is preserved and carried over (§9.3 option B).
6. `db-g1-small` initially, subject to verified Mumbai pricing and a load test.
7. Cloud Run minimum instances decided after performance testing.
8. GCP trial expiry 2027-02-26, confirmed in Billing → Overview.
9. Trial credit is not treated as a guarantee of zero charges: budget alerts and caps (§8) are required before any billed resource exists.
