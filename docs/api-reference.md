# API Reference (v1)

Base path: `/api/v1`. JSON only. Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "fieldErrors?", "details?", "requestId" } }`.

Auth: `ros_session` httpOnly cookie (staff/owners). Guests: `ros_guest` httpOnly cookie bound to one table session. Mutations must be same-origin. Money = integer minor units; rates = basis points.

Error codes → HTTP: `VALIDATION_FAILED` 422, `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `WORKSPACE_RESTRICTED` 403, `NOT_FOUND` 404 (also for other tenants' resources), `CONFLICT` / `INVALID_STATE_TRANSITION` / `STALE_VERSION` 409, `ENTITLEMENT_REQUIRED` / `LIMIT_REACHED` 402, `RATE_LIMITED` 429, `IDEMPOTENCY_MISMATCH` / `PAYMENT_REJECTED` 422, `QR_INVALID` 404, `INTERNAL_ERROR` 500.

`Idempotency-Key` header is honoured on endpoints marked **idem**: a repeat with the same key and body returns the stored response (`idempotent-replay: true`).

Ownership column = the module (`src/server/modules/<m>`) that implements it.

## Auth & session (core)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/signup` | `signUpSchema`; sets session cookie; sends verification email. Rate limited. |
| POST | `/auth/signin` | `signInSchema`; generic error for bad email/password. Rate limited. |
| POST | `/auth/signout` | Revokes session. |
| GET | `/auth/me` | `MeResponse`: user + workspaces + active workspace. |
| POST | `/auth/forgot-password` | Always 200 (no enumeration). |
| POST | `/auth/reset-password` | Single-use token; revokes all sessions. |
| POST | `/auth/verify-email` / `/auth/resend-verification` | |
| PUT | `/auth/password` | Change password; revokes other sessions. |
| PUT | `/auth/active-workspace` | `{ workspaceId }`; membership verified. |

## Workspaces (core + tenancy)

| Method | Path | Owner |
| --- | --- | --- |
| GET/POST | `/workspaces` | core — list mine / create (starts trial) |
| GET/PATCH | `/workspaces/:workspaceId` | core |
| PUT | `/workspaces/:workspaceId/onboarding` | core — persist onboarding progress |
| GET | `/workspaces/:workspaceId/entitlements` | core — `{ entitlements, usage }` |
| GET | `/workspaces/:workspaceId/structure` | core — visible restaurants + branches + permissions |
| GET | `/branches/:branchId/context` | core — `BranchContextDto` |
| GET/POST | `/workspaces/:workspaceId/restaurants` | tenancy |
| GET/PATCH/DELETE | `/restaurants/:restaurantId` | tenancy (DELETE = archive, soft) |
| GET/POST | `/restaurants/:restaurantId/branches` | tenancy |
| GET/PATCH/DELETE | `/branches/:branchId` | tenancy |
| GET/PUT | `/branches/:branchId/settings` | tenancy — taxes, service charge, payment methods, closure rules |
| GET/POST | `/workspaces/:workspaceId/members`, PATCH/DELETE `/workspaces/:workspaceId/members/:membershipId` | tenancy |
| GET/POST | `/workspaces/:workspaceId/invitations`, DELETE `.../:invitationId` | tenancy |
| GET | `/invitations/:token` (public preview), POST `/invitations/:token/accept` | tenancy |
| GET/POST | `/workspaces/:workspaceId/roles`, PATCH/DELETE `.../:roleId` | tenancy |
| GET/POST/DELETE | `/branches/:branchId/staff` | tenancy — role assignments for a branch |

## Uploads (menu module)

| POST | `/workspaces/:workspaceId/uploads` | multipart `file`, `purpose` (`menu_item` \| `logo` \| `cover`) → `{ key, url }`. Images only (PNG/JPEG/WebP, sniffed), ≤ 2 MB, storage limit enforced. |
| GET | `/files/:key*` | Serves stored objects. |

## Menu (menu module)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/restaurants/:restaurantId/menu` | Full management tree (categories → items → variants, add-on groups). `menu.view` |
| POST | `/restaurants/:restaurantId/menu/categories` | `{ name, description?, isVisible? }` → category. `menu.manage` |
| PATCH/DELETE | `/menu/categories/:categoryId` | reorder via `sortOrder` |
| POST | `/restaurants/:restaurantId/menu/items` | `{ categoryId, name, description?, price, discountedPrice?, dietary, allergens[], prepTimeMinutes, isAvailable?, isFeatured?, imageKey?, variants?[], addonGroups?[] }` |
| GET/PATCH/DELETE | `/menu/items/:itemId` | PATCH accepts full nested replace of variants/add-on groups |
| PATCH | `/menu/items/:itemId/availability` | `{ isAvailable }` |
| GET | `/branches/:branchId/menu` | Branch-effective menu (overrides applied) for staff ordering. `orders.view` |
| PUT | `/branches/:branchId/menu/overrides/:itemId` | `{ price?, discountedPrice?, isAvailable? }` (null = inherit). `menu.availability.manage` |

## Tables & QR (menu module)

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/branches/:branchId/tables` | `{ name, capacity, section? }` |
| PATCH/DELETE | `/tables/:tableId` | |
| POST | `/tables/:tableId/qr` | Generate or regenerate (revokes the previous active token). → `{ url, svg }` |
| GET | `/tables/:tableId/qr` | Current QR `{ url, svg, createdAt }` (decrypts stored token). `tables.manage` |
| DELETE | `/tables/:tableId/qr` | Revoke |

## Customer ordering (ordering module, public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/qr/:token` | Validates token → restaurant branding, branch, table name, menu (branch-effective, available items only). |
| POST | `/public/qr/:token/session` | Join or open the table session; sets `ros_guest` cookie. |
| GET | `/public/session` | Current guest session: table, status, my orders (`GuestOrderDto[]`), bill summary if issued. |
| POST | `/public/session/orders` | `placeOrderSchema` (**idem** via body `idempotencyKey`) → `GuestOrderDto` (PENDING). Requires connectivity. |
| POST | `/public/session/bill-request` | Marks session BILL_REQUESTED; notifies staff. |
| POST | `/branches/:branchId/orders` | Staff order: `staffPlaceOrderSchema`. `orders.create` |

## Staff operations (staff-ops module)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/branches/:branchId/orders` | `orderListQuerySchema` → `OrderDto[]` |
| GET | `/orders/:orderId` | `OrderDto` with timeline |
| POST | `/orders/:orderId/transition` | `orderTransitionSchema`; permission per action; 409 on stale version / invalid transition |
| PATCH | `/orders/:orderId/priority` | |
| PATCH | `/orders/:orderId/items/:itemId` | item-level kitchen status |
| GET | `/branches/:branchId/sessions` | Active tables + sessions summary (status, orders count, bill state) |
| GET | `/branches/:branchId/events` | Server-Sent Events: `order.*`, `session.*`, `bill.*` refetch hints |
| GET | `/branches/:branchId/kitchen` | KDS feed: ACCEPTED/PREPARING/READY (+ recent completed) |

## Billing (billing module)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/branches/:branchId/bills/preview` | `previewBillSchema` → totals without saving |
| POST | `/branches/:branchId/bills` | `generateBillSchema` (**idem**) → `BillDto`. Snapshots lines, taxes, discount |
| GET | `/branches/:branchId/bills` | filter by paymentStatus/date |
| GET | `/bills/:billId` | `BillDto` |
| POST | `/bills/:billId/payments` | `recordPaymentSchema` (**idem**) |
| POST | `/bills/:billId/refunds` | `refundSchema` |
| POST | `/payments/:paymentId/void` | `voidSchema` |
| POST | `/bills/:billId/void` | `voidSchema` (only with no confirmed payments) |
| POST | `/branches/:branchId/sessions/:sessionId/close` | applies closure rules |
| GET | `/branches/:branchId/payments/summary` | `PaymentSummaryDto` |

## Subscriptions, platform & support (platform module)

| `/public/plans` (GET) · `/public/announcements` (GET) · `/workspaces/:id/subscription` (GET overview + history) · `/workspaces/:id/support` (GET/POST) · `/workspaces/:id/audit` (GET) · `/admin/*` (Super Admin: overview, workspaces, plans, subscriptions, settings, announcements, support, audit) · `/jobs/subscriptions` (POST, `Authorization: Bearer CRON_SECRET`) · `/test/clock` (POST, only with `ENABLE_TEST_HOOKS`) |

## Notifications & offline (notifications module)

| `/notifications` (GET list, unread count) · `/notifications/read` (POST ids or all) · `/notifications/preferences` (GET/PUT) · `/push/subscriptions` (POST/DELETE) · `/sync/ping` (GET connectivity probe) |

## Analytics (analytics module)

| `/branches/:branchId/analytics?from&to` · `/workspaces/:id/analytics?from&to&branchId` · `/admin/analytics` |
