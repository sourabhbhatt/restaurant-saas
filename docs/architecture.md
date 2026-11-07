# Architecture

RestaurantOS is a **modular monolith split into independently deployable apps**: one API app that owns all data access, three Next.js 16 frontends, and internal TypeScript packages that hold the business rules, use cases and adapters. pnpm workspaces and Turborepo build and test only what changed.

## Apps

| App            | Package        | Port | Routes                                                                                                       | Notes                                                                                        |
| -------------- | -------------- | ---- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `apps/api`     | `@ros/api`     | 4000 | `src/app/api/v1/**` (route handlers only, a minimal root layout)                                             | Composition root in `src/composition/`; `instrumentation.ts` registers the container factory |
| `apps/console` | `@ros/console` | 3000 | `/`, public pages, `(auth)`, `/app/**` (workspace + branch), `/t/<token>` (guests), `/print`, `/dev/mailbox` | PWA (Serwist)                                                                                |
| `apps/ops`     | `@ros/ops`     | 3001 | `/` (my branches), `/waiter/<branchId>`, `/kitchen/<branchId>`, `/cashier/<branchId>`, own `/sign-in`        | PWA with the offline outbox                                                                  |
| `apps/admin`   | `@ros/admin`   | 3002 | `/admin/**`, own `/sign-in`                                                                                  | No service worker, `robots: noindex`                                                         |

Every frontend has `src/app/api/v1/[...path]/route.ts`, which re-exports `createApiProxy()` from `@ros/web-core/api-proxy`. The proxy reads `API_INTERNAL_URL` on every request (never at build time), streams request and response bodies (SSE included), relays every `Set-Cookie`, sets `x-forwarded-host`, and returns `502 { error: { code: "INTERNAL_ERROR" } }` when the API is unreachable. Each frontend also has `/healthz`. Cross-app links (`CONSOLE_URL`, `OPS_URL`, `ADMIN_URL`) are read at request time by `RuntimeAppLinks` in each root layout, so one image works in every environment.

## Packages and dependency rules

```
packages/
  domain/       Pure rules. No I/O, no framework. money, pricing, order state machine, bill calculator,
                payments, entitlements and trial lifecycle, workspace limits, permissions, table status.
  contracts/    Zod input schemas + DTO types shared by API handlers and UI forms. Depends on domain only.
  application/  Use cases (modules/<m>/{ports,service}.ts), access service, auth service, route() wrapper,
                entitlement service, audit, notifications, env schema, the Container port, the request DB context.
  database/     Drizzle schema, SQL migrations (+ migrations-down), repositories, tenant/system runners,
                snapshot/dump/restore tooling and the db:* scripts.
  adapters/     Provider implementations behind ports: identity, email, storage, realtime, payments, push, logging.
  api-client/   fetch client used by the frontends (`api.get/post/...`, `ApiError`, idempotency keys).
  ui/           Design system (components/ui, shared/feedback, `cn`).
  web-core/     Shared frontend code: app providers, layouts, API proxy, security headers, app links,
                and every feature used by two or more apps (auth, session, navigation, offline, billing, ...).
  testing/      migrate-to helper and the server-only stub.
  tooling/      tsconfig.base.json, eslint.base.mjs, vitest.base.mts, vitest.setup.ts.
```

Rules (ESLint `no-restricted-imports`, configured in `packages/tooling/eslint.base.mjs` and each package's config):

1. `domain` imports nothing from `@ros/*`, Next, React or Drizzle. `contracts` imports only `@ros/domain`.
2. `application` depends on ports: `@ros/database/interfaces/*` and `@ros/adapters/*/interfaces/*` at runtime, never `providers/**`. Type-only imports are allowed (the `Container` names the Drizzle `Executor` type).
3. `adapters` and `database` may import `@ros/application` **types only**, so the Turborepo graph stays acyclic.
4. Frontends (`apps/console|ops|admin`, `ui`, `web-core`) never import `@ros/database`, `@ros/adapters` or `@ros/application` (the `FRONTEND_BOUNDARY` rule). UI → `@ros/api-client` → `/api/v1/*` → API route → service → repository port → adapter.
5. Only `apps/api/src/composition/*` chooses providers and wires repositories.
6. Every tenant query takes its IDs from a **server-resolved scope**, never raw client IDs.

Internal packages have no build step: `exports: { "./*": ["./src/*.ts", "./src/*.tsx", "./src/*/index.ts", "./src/*/index.tsx"] }` and each app lists them in `transpilePackages`.

## Request lifecycle (API)

`route({ auth, params, query, body, rateLimit, idempotency }, handler)` in `packages/application/src/http/route.ts`:

1. request id → 2. same-origin check for mutations (CSRF: `Sec-Fetch-Site: same-origin`, or an `Origin` listed in `ALLOWED_ORIGINS`) → 3. rate limit (DB-backed fixed window, client IP from `X-Forwarded-For` per `TRUSTED_PROXY_HOPS`) → 4. session → `UserActor` → 5. Zod validation (422 with field errors) → 6. optional `Idempotency-Key` replay → 7. handler, inside a request DB context → 8. `{ data }` envelope or `{ error: { code, message, fieldErrors, requestId } }`.

Inside the handler, authorization:

```ts
const scope = await c.access.forBranch(actor, params.branchId); // 404 if not a member / other tenant
scope.require("orders.approve"); // permission + subscription access level
```

`scope.require` checks the permission at the right level (workspace role, restaurant assignment, branch assignment) **and** the workspace's entitlement access level (`operate` / `grow` / `settle` / `read`, see `domain/access/operation-kinds.ts`). Resources in another workspace return **404**, so IDs can't be probed. Once the access service has verified an ACTIVE membership it binds the workspace into the request DB context, which the tenant runner hands to Postgres row-level security (see [tenant security](tenant-security.md)).

## Tenancy and billing model

```
User ──< OrganizationMember (OWNER | BILLING_ADMIN) >── Organization ──< Subscription (current: one)
  │                                                          │
  └──< WorkspaceMembership (workspace role) >── Workspace ───┘──< Restaurant ──< Branch
                    └──< RoleAssignment (role @ restaurant | branch)
```

- The **organization** is the billing owner: the current subscription, plan and workspace limit belong to it (`subscriptions.organization_id`; `subscriptions.workspace_id` is kept and dual-written to the organization's first workspace).
- Workspace limit (`domain/subscriptions/workspace-limit.ts`): a Super Admin per-organization override wins; otherwise TRIAL or GRACE allows 1, MONTHLY billing allows 1, and ANNUAL allows the plan's `max_workspaces` (Starter 1, Pro 3, Enterprise unlimited within fair use: `fairUseMaxWorkspaces` 25 and `workspaceCreatesPerDay` 5 in platform settings).
- Trials: 15 days on Pro, 7 days of grace, reminders on days 7, 12 and 14. A person gets one trial, whatever the number of organizations they create.
- Workspace role (owner/admin/member/custom) grants workspace-wide permissions; role assignments grant restaurant-wide or single-branch permissions.
- Every tenant table carries `workspace_id`; branch data also carries `branch_id`.
- Platform Super Admin (`users.platform_role`) has **no implicit tenant access**; admin APIs live under `/api/v1/admin/*`.

## Data access pattern (per module)

```ts
// packages/application/src/modules/menu/ports.ts
export interface MenuRepository { listCategories(t: Tenant): Promise<CategoryDto[]>; ... }

// packages/application/src/modules/menu/service.ts
export function createMenuService(deps: { tx: TransactionRunner<MenuRepos>; clock: Clock; ... }) { ... }

// packages/database/src/providers/postgres/repositories/menu.ts
export function menuRepository(db: Executor): MenuRepository { ... drizzle ... }

// apps/api/src/composition/menu.ts
export function menuService(c: Container) {
  return createMenuService({
    tx: tenantRunner(c, (e) => ({ menu: menuRepository(e), audit: auditRepository(e) })),
    // System: finds the restaurant owning a category/item id; the access service then authorizes and binds.
    lookup: createSystemLookup(c.db, menuRepository, ["locateCategory", "locateItem"]),
    ...
  });
}
```

Two runners exist (`packages/database/src/providers/postgres/client.ts`):

- **Tenant runner** (`createTenantRunner`): every `run` and `read` is a transaction that does `SET LOCAL ROLE ros_tenant` and `set_config('app.workspace_id' | 'app.user_id', …, true)`. No bound context fails closed with `TENANT_CONTEXT_MISSING`.
- **System runner** (`createSystemRunner`, `createSystemLookup`): runs as the connection user. Only the files on the allow-list in `apps/api/tests/integration/security-runner-allowlist.test.ts` may use it, each with a stated reason.

`tx.run()` is atomic. Audit rows and in-app notifications are written in the same transaction as the change.

## Concurrency and money

- Order/bill/payment state changes use conditional updates (`WHERE status = ... AND version = ...`); a lost race returns 409.
- Partial unique indexes guarantee one open session per table, one live bill per session, one active QR per table, one current subscription per organization.
- Money is integer minor units (`bigint`), rates are basis points. Orders and bills snapshot names, prices and taxes.

## Realtime

Realtime is a "refetch" hint only: `c.realtime.publish("branch:<id>", { type, data })` after commit, delivered over SSE (`/api/v1/branches/:id/events`, streamed through the frontend proxy). `REALTIME_PROVIDER=memory` keeps it in one process; `postgres` uses `LISTEN/NOTIFY` so several API instances share events; `none` disables it. Clients always poll as well, so a lost message never loses data.

## Frontend

- Server state: TanStack Query (`networkMode: offlineFirst`). Query keys per feature.
- Client state: Zustand (cart, UI prefs, app links). Local persistence: Dexie (see `docs/offline-sync.md`).
- Forms: React Hook Form + zodResolver with the shared contracts; server field errors mapped via `applyFieldErrors`.
- Signed-in areas use `AuthGate` (UX only) and each app's `proxy.ts` (optimistic redirect to that app's `/sign-in` when no `ros_session` cookie is present; matchers: console `/app/*`, ops `/waiter|/kitchen|/cashier/*`, admin `/admin/*`). The server enforces everything.
- `cacheComponents` and `partialPrefetching` are on in every app. The client-gated layouts (`/app/w/[workspaceId]`, `/app/b/[branchId]`, `/print/tables`, `/cashier/[branchId]`, `/admin`) export `instant = false`: `AuthGate` renders a skeleton instead of `{children}` on the server, so the page segment cannot be prerendered for instant-navigation validation.

## Navigation and identity (UI)

- **One profile menu** (`packages/web-core/src/features/navigation/profile-menu.tsx`) in every layout: name, email, the role in the current context (`roleLabel` from the server), workspace and branch, a workspace switcher, Dashboard, Account settings, Super Admin / Back to my workspaces, and Sign out. Links to other apps use `useAppLinks()`.
- **Identity** comes from `/auth/me` via `useIdentity()`. Data restored from the offline cache is never shown as identity until the server has confirmed it on this page load. Sign-out clears the in-memory cache **and** the device's stored cache/drafts, then redirects to `/sign-in` on the same origin.
- **Context hierarchy** in the sidebar (`context-switcher.tsx`): Workspace → Restaurant → Branch; switching branch keeps the current section.
- **Route guard**: `DashboardShell` looks up the permission required for the current path (`requiredPermissionFor`) and shows an explanation instead of the page when the user lacks it. This is a UX layer only; every API call is authorized on the server.

## Build and deploy

One Dockerfile (`infra/docker/next-app.Dockerfile`, `--build-arg APP=<app>`) prunes the workspace with `turbo prune`, builds the app in standalone mode and produces a `node:22-slim` image per app (plus a `migrate` target). CI builds only affected apps and packages. See [deployment](deployment.md).
