# Tenant Security

## Threat model (what we defend against)

- A signed-in user of workspace A reading or changing workspace B's data by editing IDs in URLs or bodies (IDOR).
- Staff exceeding their role (waiter recording payments, kitchen approving orders, cashier editing menus).
- A guest at one table seeing other guests' orders, or using an old/revoked QR code.
- Cross-site request forgery against cookie-authenticated endpoints.
- Credential stuffing and brute force on auth endpoints.
- Replayed or duplicated writes (double payment, duplicate orders) from retries or offline sync.
- Leaking internals through error messages or logs.

## Controls

**Authentication** — `packages/adapters/src/auth/providers/local-identity.ts`

- Passwords: scrypt (N=2^17, r=8, p=1, 16-byte salt), NFKC-normalized, constant-time compare. A real dummy hash is verified for unknown emails to equalize timing; one generic error for wrong email or password.
- Sessions: 32-byte random tokens; only SHA-256 hashes stored; `HttpOnly; SameSite=Lax; Secure` (when HTTPS) cookie; sliding expiry; revocation on sign-out, password change (other sessions) and password reset (all sessions).
- Reset / verification tokens: random, hashed, single-use (atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now()`), 1 h / 48 h expiry, max 5 per hour per user; forgot-password always returns 200 (no enumeration).

**Authorization** — `packages/application/src/authz/access-service.ts`

- Every protected handler calls `c.access.forWorkspace | forRestaurant | forBranch(actor, id)`. The ID is a _request_: the service loads the resource, finds its workspace, loads the actor's ACTIVE membership and grants **from the database**, and only then returns a scope. Not a member → **404** (same as non-existent), so IDs cannot be probed.
- `scope.require(permission)` checks the permission at the right level (workspace role; restaurant assignment covering all branches; branch assignment for that branch only) **and** the subscription access level for that permission (`operationKindFor`). Code never checks role names.
- Repositories receive the scope's IDs and include `workspace_id` (and `branch_id`) in every filter, including updates and deletes.
- Inputs are validated by Zod schemas with explicit fields (no mass assignment); patches are built from named fields.
- Super Admin is a separate `platform_role` with separate `/api/v1/admin/*` endpoints (`route({ auth: "platform" })`); it does not grant tenant access through normal APIs. Every admin mutation is audited.

**Guests (QR ordering)**

- QR URL `/t/<token>`: 32 random bytes, no internal IDs. DB stores SHA-256 for lookup and AES-256-GCM ciphertext (key derived from `APP_SECRET`) so managers can re-download; regenerate revokes the previous token; revoked/unknown/inactive all return the same `QR_INVALID`.
- Joining a session sets a `ros_guest` cookie bound to one table session (hash stored). Guests see only their own orders, the table status, and the table bill once issued. Prices from the client are ignored; the server reprices from the menu.

**Request hygiene** — `packages/application/src/http/route.ts`

- CSRF: mutations require `Sec-Fetch-Site: same-origin` (or `none`) or an `Origin` listed in `ALLOWED_ORIGINS` (the console, ops and admin origins); cookies are `SameSite=Lax`. Webhooks and cron endpoints opt out explicitly and authenticate by signature or bearer secret.
- Client IP for rate limits and audit comes from `X-Forwarded-For`, trusting only `TRUSTED_PROXY_HOPS` proxies (`packages/application/src/http/client-ip.ts`); everything left of them is client-supplied and ignored. Where the frontends reach the API over a public URL (Cloud Run), the frontend proxy forwards the browser's address in `x-ros-client-ip`, HMAC-signed with `PROXY_SHARED_SECRET` and a 60 s timestamp (`@ros/domain/shared/signed-client-ip`); the API accepts it only with a valid, fresh signature and otherwise falls back to the hop rule, so direct callers cannot pick their own address.
- Rate limits (Postgres-backed, multi-instance safe) on sign-in, sign-up, forgot/reset, verify, public QR and order endpoints.
- Each app has its own `ros_session` cookie on its own origin; the frontends relay it to the API through their `/api/v1` proxy, so it is never a third-party cookie. Signing out on one app does not sign out the others.
- `Idempotency-Key` replay for payments, bills and orders, plus DB unique keys (`(branch_id, idempotency_key)`).
- Errors: stable codes and safe messages; 5xx responses never include stack traces or driver messages; a `requestId` links the user report to server logs.
- Logs redact keys matching password/token/secret/cookie/authorization/api-key/hash.
- Security headers on every frontend (`packages/web-core/src/security-headers.ts`): `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`.
- Uploads: images only (magic-byte sniffing, PNG/JPEG/WebP, no SVG), size limit, random keys, served with `nosniff`.

**Data integrity**

- Conditional updates with `version` and status predicates prevent double acceptance and lost updates (409 on conflict).
- Partial unique indexes: one open session per table, one live bill per session, one active QR per table, one current subscription per organization.
- Order and bill snapshots: historical records never change when the menu or tax settings change.

## Database-level isolation (row-level security)

The application layer enforces isolation on every query (above). Postgres row-level security (migration `0002_tenant_rls`, extended by `0003_organizations` and `0005_payments`) is a second, independent layer: a query that forgets its `workspace_id` filter still returns only the bound workspace's rows.

**Roles** (created by the migrations, `NOLOGIN`; no role needs `BYPASSRLS` or superuser, so this works on any managed Postgres):

| Role          | Who                                                                                                              | Policies                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| owner         | the user that runs migrations and owns the tables (`restaurantos` in compose)                                    | bypasses RLS, because policies are `ENABLE`d, not `FORCE`d               |
| `ros_runtime` | the API's login in compose and production (given a password by `infra/compose/init-roles.sql`); DML only, no DDL | `runtime_access … USING (true)`: the system runner's paths see every row |
| `ros_tenant`  | the role every tenant transaction switches into; `ros_runtime` and the owner are members                         | `tenant_isolation` (below)                                               |

**Policies** on every table listed in `packages/database/src/providers/postgres/tenant-tables.ts` (every table with `workspace_id`):

- `tenant_isolation TO ros_tenant`: `USING / WITH CHECK (workspace_id = app_current_workspace())`.
- `notifications` and `workspace_memberships` also have `tenant_own_rows FOR SELECT … USING (user_id = app_current_user())`, so a user's own rows in other workspaces stay readable (bell, workspace switcher).
- `roles` also has `tenant_system_roles FOR SELECT … USING (workspace_id IS NULL)` (system roles).
- `organizations`, `organization_members`, `payment_orders`, `payment_events`: readable for the bound workspace's organization and every organization the bound user belongs to; tenant `INSERT/UPDATE/DELETE` is revoked (billing writes go through the system runner).
- Grants: `ros_tenant` cannot read `sessions`, `auth_tokens`, `rate_limit_buckets`, `idempotency_records`, `email_outbox`; it reads only `users(id, name, email)`; it cannot write `permissions`, `subscription_plans`, `platform_settings`, `announcements`.
- Migration `0006_workspace_and_user_rls` covers the tables without a `workspace_id` of their own (`WORKSPACE_SCOPED_TABLES` and `USER_TABLES` in `tenant-tables.ts`): `workspaces` is readable for the bound workspace and every workspace the bound user is an active member of, updatable for the bound one only, and tenant `INSERT`/`DELETE` is revoked (creation is the bootstrap path on the system runner, deletion is Super Admin); `branch_counters`, `role_permissions`, `support_request_notes` and `upgrade_request_events` are scoped through their parent row (`branches`, `roles`, `support_requests`, `upgrade_requests`), with system roles' permissions readable only and internal support notes never visible or writable; `user_profiles`, `push_subscriptions` and `notification_preferences` are the bound user's own rows, plus read access to the bound workspace's members' preferences (`tenant_workspace_members`) so the in-app fan-out can honour opt-outs. `security-rls.test.ts` also asserts that every public table `ros_tenant` can touch has RLS enabled or sits on an explicit allow-list of reference tables.

`app_current_workspace()` / `app_current_user()` read the transaction-local settings `app.workspace_id` / `app.user_id`.

**Runtime** (`packages/database/src/providers/postgres/client.ts`, `apps/api/src/composition/runners.ts`):

1. `route()` opens a request DB context (`AsyncLocalStorage`, `packages/application/src/db-context.ts`). Authentication binds the user; the access service binds the workspace only after it has verified an ACTIVE membership (guest and invitation paths bind it after the token lookup). Binding a second, different workspace in one request throws `TENANT_CONTEXT_CONFLICT`.
2. The tenant runner wraps every `run` **and** `read` in a transaction: `SET LOCAL ROLE ros_tenant`, then `set_config('app.workspace_id', …, true)` and `set_config('app.user_id', …, true)`. Both end with the transaction, so nothing leaks to the next user of a pooled connection. No bound context fails closed (`TENANT_CONTEXT_MISSING`).
3. The system runner runs as the connection user (owner or `ros_runtime`) and is allowed only in the files listed, with a reason each, in `apps/api/tests/integration/security-runner-allowlist.test.ts`: authentication and sessions, the authorization lookup itself (id → owning branch/restaurant), entitlements, QR/guest/invitation token lookups, workspace bootstrap, scheduled jobs, the Super Admin console, payments (checkout, verify, webhook) and the dev mailbox. The test scans `packages/application/src` and the API's composition, handlers and routes, and fails when any other file uses system access (the system runner, a system lookup or the raw `c.db`); a second test pins which route handlers may call the container's owner-level core repositories.

**Switch-off:** `DATABASE_TENANT_ROLE=none` stops the role switch (startup logs `tenant_role_disabled`); the down scripts in `migrations-down/` remove the policies. Both are emergency measures: see [disable RLS](runbooks/disable-rls-emergency.md).

**Where it is tested:** `apps/api/tests/integration/security-rls.test.ts` runs on PGlite, which enforces RLS after `SET LOCAL ROLE` (scoped queries see their own rows, unscoped see none). It also checks that `TENANT_TABLES` matches the live schema (a new tenant table fails the suite until it has policies), that the migration re-runs cleanly and that the down scripts revert it. CI's `integration-pg` job runs it again on Postgres 18 together with the dump/restore suite, for role and grant behaviour PGlite cannot reproduce. The whole integration suite runs with the role switch on.

## Tests that attack isolation

- `apps/api/tests/integration/auth-and-workspaces.test.ts` — IDOR on workspace read/update, CSRF block, stale version, enumeration-safe sign-in.
- `security-tenant-isolation`, `security-rbac-matrix` and `security-subscription-enforcement` (every route × role and phase), and the module suites (`apps/api/tests/integration/*`) include cross-workspace and cross-branch denial and role-restriction cases for every endpoint group (tenancy, menu, ordering, staff-ops, billing, platform, analytics, notifications).
- `apps/api/tests/integration/payments-razorpay.test.ts` — checkout and verify by a non-member (404), forged checkout and webhook signatures (401, nothing written), amount mismatch (never activates), and tenant read-only access to `payment_orders` scoped by organization.

## Super Admin inspection and upgrade approval

- Super Admin reads another tenant's menu only through the dedicated read-only endpoint `GET /api/v1/admin/workspaces/:workspaceId/restaurants/:restaurantId/menu`. It requires the platform role, verifies the restaurant belongs to the workspace in the URL (404 otherwise), never writes, and does not create a menu.
- Upgrade approval and rejection are platform-role endpoints. Approval changes the subscription in the same transaction as the request status; the request can be decided once (conditional update), and every decision is audited with actor and time. Owners can only create, list and cancel requests of their own workspace; other tenants' ids return 404, and internal notes are never returned to workspaces.
