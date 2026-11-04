# Architecture Overview

**Status:** PROPOSED (Phase 1). This is the high-level shape for approval. The detailed design spec comes after approval.

## 1. Shape of the system

```
 Browser (installable PWA, one app, role-based areas)
 ┌─────────────────────────────────────────────────────────────┐
 │ UI (React, design system)                                   │
 │   └─ feature hooks ─► application client (typed API client) │
 │                     └─► LocalStore (Dexie/IndexedDB)        │
 │                     └─► Sync engine (outbox, retry, pull)   │
 │                     └─► RealtimeClient port (Ably adapter)  │
 └───────────────┬─────────────────────────────────────────────┘
                 │ HTTPS (JSON, zod-validated, OpenAPI)
 ┌───────────────▼─────────────────────────────────────────────┐
 │ API (Hono) — transport only: auth session, tenant context,  │
 │              validation, rate limit, error mapping          │
 │   └─► Application use cases (packages/core)                 │
 │         └─► Domain (entities, state machines, pricing, RBAC │
 │              policy, entitlements) — no I/O, no SDKs        │
 │         └─► Ports (interfaces)                              │
 │   └─► Infrastructure adapters (only place SDKs are imported)│
 │         mongo/ · better-auth/ · ably/ · s3/ · web-push/ ·   │
 │         brevo/ · resend/ · sentry/                          │
 │   └─► container.ts — composition root, picks adapters by env│
 └─────────────────────────────────────────────────────────────┘
```

**Rule:** `packages/core` has zero provider dependencies. It doesn't import `mongodb`, `ably`, `@aws-sdk/*`, `better-auth` or any other SDK. A dependency lint rule enforces this in CI.

## 2. Planned repository layout

> **Superseded (2026-11-04):** the project is now one Next.js App Router app rather than a monorepo. See the README "Structure" section and the decision log in `technology-decisions.md`. The layering rules in §1 and §3 still apply: business logic depends on interfaces in `src/infrastructure/*/interfaces`, and only `providers/` import SDKs. The original proposal is kept below for reference.

```
apps/
  web/            React PWA (customer, waiter, kitchen, owner, admin areas)
    src/features/<feature>/   UI + hooks per feature
    src/local/                LocalStore interface + Dexie implementation
    src/sync/                 sync engine (outbox, retry, conflict handling)
  api/            Hono server
    src/http/<module>/        routes per module (thin)
    src/infrastructure/<provider>/   adapters
    src/container.ts          dependency wiring
    migrations/               MongoDB migrations (indexes, validators, data)
  jobs/           Cloudflare Cron Worker (calls signed API endpoints)
packages/
  core/           domain + application use cases + ports (pure TS)
  contracts/      zod schemas = API DTOs + sync operation schema (shared by web & api)
  ui/             design system (shadcn/ui + Tailwind tokens)
  config/         shared tsconfig / eslint / vitest presets
docs/             required documentation set
```

Feature modules (same names in `core`, `api/http` and `web/features`): `identity`, `workspaces`, `restaurants` (incl. branches, hours, tax, rules), `staff`, `tables` (incl. QR), `menu`, `ordering` (table sessions, orders), `kitchen`, `billing` (bills, payments), `subscriptions` (plans, trials, entitlements), `notifications`, `audit`, `platform-admin`.

## 3. Ports (what is abstracted, and nothing more)

| Port                                                           | Why it's replaceable                                |
| -------------------------------------------------------------- | --------------------------------------------------- |
| Repositories (one per aggregate) + `UnitOfWork` (transactions) | Database swap                                       |
| `AuthProvider` (verify session → identity)                     | Auth vendor swap                                    |
| `ObjectStorage` (put/get/delete/signedUrl)                     | Storage swap                                        |
| `RealtimePublisher` (server) / `RealtimeClient` (web)          | Realtime swap                                       |
| `PushSender`, `EmailSender`, `InAppNotifier`                   | Each channel swappable independently                |
| `ErrorReporter`, `Logger`                                      | Monitoring swap                                     |
| `Clock`, `IdGenerator`                                         | Testability (trial-expiry tests, deterministic IDs) |

Not abstracted on purpose: the HTTP framework, React and the validation library. These are application frameworks, not infrastructure providers.

## 4. Multi-tenancy model

```
User (global) ──< Membership >── Workspace ──< Restaurant ──< Branch ──< Table
                    role scope:  workspace | restaurant | branch
```

- Every tenant document carries `workspaceId`; restaurant/branch data also carries `restaurantId` / `branchId`.
- **Tenant context is resolved on the server** for every request: session → user → memberships → allowed scope. IDs sent by the client are only _requests_. They're checked against memberships before any query runs.
- RBAC: roles are named sets of permissions (`order.accept`, `payment.record`, `menu.edit`...). Default roles are seeded; owners can customize permissions per restaurant where it makes sense. Checks live in core policy functions, called by every use case.
- Customers: a QR token (128-bit random, stored as a SHA-256 hash, revocable) resolves to a branch and table. Internal IDs never appear in public URLs.

## 5. Order and billing flow (authoritative on the server)

`pending_approval → accepted → preparing → ready → served` (or `rejected` / `cancelled`). This is enforced by a domain state machine and by conditional database updates (`status` + `version`).
Bill: `draft → issued → paid` (or `void`). A payment is a separate record, and confirming it is a single transaction.

## 6. Offline-first (staff devices)

- **Reads:** menu, tables, open orders and recent history are cached in IndexedDB and refreshed on every connection.
- **Writes:** go to a local **outbox** first (op ID, entity type and ID, op type, idempotency key, payload, createdAt, retryCount, status). The UI updates immediately with a _pending_ badge.
- The sync engine pushes the outbox in order on reconnect, on an interval, on the Background Sync API (where supported) and on the manual "Sync now" button. It uses backoff retries and resumes after interrupted syncs.
- The server applies each op idempotently (unique idempotency key) and checks the expected entity `version`. On a mismatch it returns a **conflict**; the client shows the server state and the rejected change.
- **Server-authoritative actions** (accept order, record payment, permission changes) are stored offline as _requests_ and are only shown as done after the server confirms them. A payment is never shown as confirmed from offline state.
- Customer ordering needs connectivity (by requirement). The customer UI says so clearly when offline.

## 7. Subscriptions

Plans, prices, trial length, grace length, limits and feature flags are **data** (editable by Super Admin), not code.
Workspace status is **computed** from `trialEndsAt`, `currentPeriodEnd` and `graceEndsAt`: `trial_active → trial_expiring → trial_expired → grace → restricted (read-only) → reactivated | retention_scheduled`.
Every write use case calls `entitlements.assert(workspace, feature)`. Data is never deleted on expiry. Deletion only happens after the disclosed retention period, and an export is available first.
