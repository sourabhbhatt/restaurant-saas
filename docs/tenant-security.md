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

**Authentication** — `src/infrastructure/auth/providers/local-identity.ts`

- Passwords: scrypt (N=2^17, r=8, p=1, 16-byte salt), NFKC-normalized, constant-time compare. A real dummy hash is verified for unknown emails to equalize timing; one generic error for wrong email or password.
- Sessions: 32-byte random tokens; only SHA-256 hashes stored; `HttpOnly; SameSite=Lax; Secure` (when HTTPS) cookie; sliding expiry; revocation on sign-out, password change (other sessions) and password reset (all sessions).
- Reset / verification tokens: random, hashed, single-use (atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now()`), 1 h / 48 h expiry, max 5 per hour per user; forgot-password always returns 200 (no enumeration).

**Authorization** — `src/server/authz/access-service.ts`

- Every protected handler calls `c.access.forWorkspace | forRestaurant | forBranch(actor, id)`. The ID is a _request_: the service loads the resource, finds its workspace, loads the actor's ACTIVE membership and grants **from the database**, and only then returns a scope. Not a member → **404** (same as non-existent), so IDs cannot be probed.
- `scope.require(permission)` checks the permission at the right level (workspace role; restaurant assignment covering all branches; branch assignment for that branch only) **and** the subscription access level for that permission (`operationKindFor`). Code never checks role names.
- Repositories receive the scope's IDs and include `workspace_id` (and `branch_id`) in every filter, including updates and deletes.
- Inputs are validated by Zod schemas with explicit fields (no mass assignment); patches are built from named fields.
- Super Admin is a separate `platform_role` with separate `/api/v1/admin/*` endpoints (`route({ auth: "platform" })`); it does not grant tenant access through normal APIs. Every admin mutation is audited.

**Guests (QR ordering)**

- QR URL `/t/<token>`: 32 random bytes, no internal IDs. DB stores SHA-256 for lookup and AES-256-GCM ciphertext (key derived from `APP_SECRET`) so managers can re-download; regenerate revokes the previous token; revoked/unknown/inactive all return the same `QR_INVALID`.
- Joining a session sets a `ros_guest` cookie bound to one table session (hash stored). Guests see only their own orders, the table status, and the table bill once issued. Prices from the client are ignored; the server reprices from the menu.

**Request hygiene** — `src/server/http/route.ts`

- CSRF: mutations require `Sec-Fetch-Site: same-origin` or a matching `Origin`; cookies are `SameSite=Lax`.
- Rate limits (Postgres-backed, multi-instance safe) on sign-in, sign-up, forgot/reset, verify, public QR and order endpoints.
- `Idempotency-Key` replay for payments, bills and orders, plus DB unique keys (`(branch_id, idempotency_key)`).
- Errors: stable codes and safe messages; 5xx responses never include stack traces or driver messages; a `requestId` links the user report to server logs.
- Logs redact keys matching password/token/secret/cookie/authorization/api-key/hash.
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`.
- Uploads: images only (magic-byte sniffing, PNG/JPEG/WebP, no SVG), size limit, random keys, served with `nosniff`.

**Data integrity**

- Conditional updates with `version` and status predicates prevent double acceptance and lost updates (409 on conflict).
- Partial unique indexes: one open session per table, one live bill per session, one active QR per table, one current subscription per workspace.
- Order and bill snapshots: historical records never change when the menu or tax settings change.

## Database-level isolation (status)

The application layer enforces isolation on every query (above), and every tenant table carries `workspace_id` with indexes leading on it. **Postgres Row-Level Security is not yet enabled.** Planned hardening (see `implementation-roadmap.md`): run the app as a non-owner role, `ENABLE`/`FORCE ROW LEVEL SECURITY` on tenant tables with `workspace_id = current_setting('app.workspace_id')::uuid`, and set the setting per transaction in `createTransactionRunner`. RLS tests must run on real Postgres (PGlite runs as superuser and bypasses RLS).

## Tests that attack isolation

- `tests/integration/auth-and-workspaces.test.ts` — IDOR on workspace read/update, CSRF block, stale version, enumeration-safe sign-in.
- Module suites (`tests/integration/*`) include cross-workspace and cross-branch denial and role-restriction cases for every endpoint group (tenancy, menu, ordering, staff-ops, billing, platform, analytics, notifications).

## Super Admin inspection and upgrade approval

- Super Admin reads another tenant's menu only through the dedicated read-only endpoint `GET /api/v1/admin/workspaces/:workspaceId/restaurants/:restaurantId/menu`. It requires the platform role, verifies the restaurant belongs to the workspace in the URL (404 otherwise), never writes, and does not create a menu.
- Upgrade approval and rejection are platform-role endpoints. Approval changes the subscription in the same transaction as the request status; the request can be decided once (conditional update), and every decision is audited with actor and time. Owners can only create, list and cancel requests of their own workspace; other tenants' ids return 404, and internal notes are never returned to workspaces.
