# Architecture

RestaurantOS is a **modular monolith**: one Next.js 16 App Router application that serves the web UI (all roles), a versioned REST API under `/api/v1`, and the service worker. Business rules live outside React and outside provider SDKs.

## Layers and dependency rules

```
src/
  domain/            Pure business rules. No I/O, no framework, no SDKs. Unit tested.
                     money, pricing, order state machine, bill calculator, payments,
                     entitlements/trial lifecycle, permissions/roles, table status.
  contracts/         Zod input schemas + DTO types shared by API handlers and UI forms.
  server/            Application layer (server only).
    container.ts     Composition root: chooses providers from env (see provider docs).
    composition/     Per-module wiring: binds module ports to the Postgres adapters.
    http/            route() wrapper, cookies, error mapping.
    authz/           Access service: tenant scopes + permission + subscription checks.
    auth/            Auth use cases (sign up/in/out, reset, verify).
    subscriptions/   Entitlement service (getWorkspaceEntitlements).
    audit/           recordAudit()
    notifications/   Email sending through the outbox.
    modules/<m>/     ports.ts (repository interfaces, domain types) + service.ts (use cases).
    ports/           Cross-cutting repository/observability ports.
  infrastructure/    The ONLY place provider SDKs are imported.
    database/providers/postgres/   schema/, migrations/, repositories/<module>.ts, client.ts
    auth/ email/ storage/ realtime/ push/ logging/   interfaces/ + providers/
  features/<f>/      Client UI per feature: components, TanStack Query hooks, Zustand stores.
  components/        ui/ (design system), shared/feedback/, layouts/
  app/               Routes only. Pages render feature components; route.ts files call route().
```

Rules (lint-enforced where possible):

1. `app/`, `features/`, `components/` never import `@/infrastructure/*/providers`.
2. UI never talks to the database. UI → `@/lib/api-client` → `/api/v1/*` → service → repository port → adapter.
3. Services depend on ports (`TransactionRunner<Repos>`, `Clock`, `EntitlementService`, ...), never on Drizzle.
4. Every tenant query takes the IDs from a **server-resolved scope**, never raw client IDs.

## Request lifecycle

`route({ auth, params, query, body, rateLimit, idempotency }, handler)` in `src/server/http/route.ts`:

1. request id → 2. same-origin check for mutations (CSRF; cookies are `SameSite=Lax`, `HttpOnly`) → 3. rate limit (DB-backed fixed window) → 4. session → `UserActor` → 5. zod validation (422 with field errors) → 6. optional `Idempotency-Key` replay → 7. handler → 8. `{ data }` envelope or `{ error: { code, message, fieldErrors, requestId } }`.

Inside the handler, authorization:

```ts
const scope = await c.access.forBranch(actor, params.branchId); // 404 if not a member / other tenant
scope.require("orders.approve"); // permission + subscription access level
```

`scope.require` checks the permission at the right level (workspace role, restaurant assignment, branch assignment) **and** the workspace's entitlement access level (`operate` / `grow` / `settle` / `read`, see `domain/access/operation-kinds.ts`). Resources in another workspace return **404**, so IDs can't be probed.

## Tenancy model

```
User ──< WorkspaceMembership (workspace role) >── Workspace ──< Restaurant ──< Branch
                    └──< RoleAssignment (role @ restaurant | branch)
```

- Workspace role (owner/admin/member/custom) grants workspace-wide permissions.
- Role assignments grant restaurant-wide (all branches) or single-branch permissions.
- Every tenant table carries `workspace_id`; branch data also carries `branch_id`.
- Platform Super Admin (`users.platform_role`) has **no implicit tenant access**; admin APIs live under `/api/v1/admin/*`.

## Data access pattern (per module)

```ts
// server/modules/menu/ports.ts
export interface MenuRepository { listCategories(workspaceId: string, restaurantId: string): Promise<CategoryDto[]>; ... }
export interface MenuRepos { menu: MenuRepository; audit: AuditRepository }

// server/modules/menu/service.ts
export function createMenuService(deps: { tx: TransactionRunner<MenuRepos>; clock: Clock; entitlements: EntitlementService }) { ... }

// infrastructure/database/providers/postgres/repositories/menu.ts
export function menuRepository(db: Executor): MenuRepository { ... drizzle ... }

// server/composition/menu.ts
export const menuService = (c: Container) => createMenuService({ tx: createTransactionRunner(c.db, (db) => ({ menu: menuRepository(db), audit: auditRepository(db) })), ... });
```

`tx.run()` is atomic; `tx.read()` is not. Audit rows and in-app notifications are written in the same transaction as the change.

## Concurrency and money

- Order/bill/payment state changes use conditional updates (`WHERE status = ... AND version = ...`); a lost race returns 409.
- Partial unique indexes guarantee one open session per table, one live bill per session, one active QR per table.
- Money is integer minor units (`bigint`), rates are basis points. Orders and bills snapshot names, prices and taxes.

## Realtime

Realtime is a "refetch" hint only: `c.realtime.publish("branch:<id>", { type, data })` after commit, delivered over SSE by the in-process bus; clients also poll, so a lost message never loses data.

## Frontend

- Server state: TanStack Query (`networkMode: offlineFirst`). Query keys per feature.
- Client state: Zustand (cart, UI prefs). Local persistence: Dexie (see `docs/offline-sync.md`).
- Forms: React Hook Form + zodResolver with the shared contracts; server field errors mapped via `applyFieldErrors`.
- Distinct layouts: public site, auth, workspace dashboard, branch management, waiter, kitchen, cashier, customer QR, Super Admin.
- Signed-in areas use `AuthGate` (UX only) and `proxy.ts` (optimistic redirect). The server enforces everything.

## Navigation and identity (UI)

- **One profile menu** (`src/features/navigation/profile-menu.tsx`) is used by every layout: dashboard shell, waiter, kitchen, cashier, account page and Super Admin. It shows name, email, the user's role in the current context (`roleLabel` from the server: workspace role for owners/admins, otherwise the restaurant/branch roles that apply), workspace and branch, a workspace switcher (when the user belongs to several), Dashboard, Account settings, Super Admin / Back to my workspaces, and Sign out.
- **Identity** comes from `/auth/me` via `useIdentity()`. Data restored from the offline cache is treated as stale and is never displayed as identity until the server has confirmed it on this page load (the same page load that triggers one refetch; navigation does not refetch). Switching workspace only changes the session's active workspace; the account is untouched. Sign-out clears the in-memory cache **and** the device's stored cache/drafts, then redirects to `/sign-in`.
- **Context hierarchy** in the sidebar (`context-switcher.tsx`): Workspace (always the business name, with the workspace switcher) → Restaurant → Branch (a separate selector; switching keeps the current section, e.g. `/app/b/<old>/menu` → `/app/b/<new>/menu`). Branch pages no longer present the branch as the workspace identity.
- **Route guard**: `DashboardShell` looks up the permission required for the current path from the nav config (`requiredPermissionFor`) and shows an explanation instead of the page when the user lacks it, including when the URL was typed by hand. `/admin/*` additionally requires the platform role. This is a UX layer only; every API call is authorized on the server (see `tenant-security.md`).
