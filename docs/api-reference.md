# API Reference (v1)

Base path: `/api/v1`. JSON only. Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "fieldErrors?", "details?", "requestId" } }`.

Auth: `ros_session` httpOnly cookie (staff/owners). Guests: `ros_guest` httpOnly cookie bound to one table session. Mutations must be same-origin. Money = integer minor units; rates = basis points.

Error codes → HTTP: `VALIDATION_FAILED` 422, `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `WORKSPACE_RESTRICTED` 403, `NOT_FOUND` 404 (also for other tenants' resources), `CONFLICT` / `INVALID_STATE_TRANSITION` / `STALE_VERSION` 409, `ENTITLEMENT_REQUIRED` / `LIMIT_REACHED` 402, `TRIAL_ALREADY_USED` 409, `MAINTENANCE` 503, `RATE_LIMITED` 429, `IDEMPOTENCY_MISMATCH` / `PAYMENT_REJECTED` 422, `QR_INVALID` 404, `INTERNAL_ERROR` 500.

`Idempotency-Key` header is honoured on endpoints marked **idem**: a repeat with the same key and body returns the stored response (`idempotent-replay: true`).

Ownership column = the module (`src/server/modules/<m>`) that implements it.

## Auth & session (core)

| Method | Path                                               | Notes                                                                        |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/auth/signup`                                     | `signUpSchema`; sets session cookie; sends verification email. Rate limited. |
| POST   | `/auth/signin`                                     | `signInSchema`; generic error for bad email/password. Rate limited.          |
| POST   | `/auth/signout`                                    | Revokes session.                                                             |
| GET    | `/auth/me`                                         | `MeResponse`: user + workspaces + active workspace.                          |
| POST   | `/auth/forgot-password`                            | Always 200 (no enumeration).                                                 |
| POST   | `/auth/reset-password`                             | Single-use token; revokes all sessions.                                      |
| POST   | `/auth/verify-email` / `/auth/resend-verification` |                                                                              |
| PUT    | `/auth/password`                                   | Change password; revokes other sessions.                                     |
| PUT    | `/auth/active-workspace`                           | `{ workspaceId }`; membership verified.                                      |

## Workspaces (core + tenancy)

| Method           | Path                                                                                              | Owner                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST         | `/workspaces`                                                                                     | core — list mine / create: `{ name, organizationId? }`. The first workspace creates an organization and starts its trial (`TRIAL_ALREADY_USED` 409 for a second trial); later ones join an organization the caller owns (`organizationId` required when owning several, 422) within its limit (`LIMIT_REACHED` 402 with `details.reason` `PLAN_LIMIT`, `FAIR_USE` or `DAILY_LIMIT`) |
| GET              | `/organizations`                                                                                  | core — `OrganizationSummaryDto[]`: the caller's organizations with role, workspace count and the workspaces each may hold now                                                                                                                                                                                                                                                       |
| GET/PATCH        | `/workspaces/:workspaceId`                                                                        | core                                                                                                                                                                                                                                                                                                                                                                                |
| PUT              | `/workspaces/:workspaceId/onboarding`                                                             | core — persist onboarding progress                                                                                                                                                                                                                                                                                                                                                  |
| GET              | `/workspaces/:workspaceId/entitlements`                                                           | core — `{ entitlements, usage }`                                                                                                                                                                                                                                                                                                                                                    |
| GET              | `/workspaces/:workspaceId/structure`                                                              | core — visible restaurants + branches + permissions                                                                                                                                                                                                                                                                                                                                 |
| GET              | `/branches/:branchId/context`                                                                     | core — `BranchContextDto`                                                                                                                                                                                                                                                                                                                                                           |
| GET/POST         | `/workspaces/:workspaceId/restaurants`                                                            | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/PATCH/DELETE | `/restaurants/:restaurantId`                                                                      | tenancy (DELETE = archive, soft)                                                                                                                                                                                                                                                                                                                                                    |
| GET/POST         | `/restaurants/:restaurantId/branches`                                                             | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/PATCH/DELETE | `/branches/:branchId`                                                                             | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/PUT          | `/branches/:branchId/settings`                                                                    | tenancy — taxes, service charge, payment methods, closure rules                                                                                                                                                                                                                                                                                                                     |
| GET/POST         | `/workspaces/:workspaceId/members`, PATCH/DELETE `/workspaces/:workspaceId/members/:membershipId` | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/POST         | `/workspaces/:workspaceId/invitations`, DELETE `.../:invitationId`                                | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET              | `/invitations/:token` (public preview), POST `/invitations/:token/accept`                         | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/POST         | `/workspaces/:workspaceId/roles`, PATCH/DELETE `.../:roleId`                                      | tenancy                                                                                                                                                                                                                                                                                                                                                                             |
| GET/POST/DELETE  | `/branches/:branchId/staff`                                                                       | tenancy — role assignments for a branch                                                                                                                                                                                                                                                                                                                                             |

## Uploads (menu module)

| POST | `/workspaces/:workspaceId/uploads` | multipart `file`, `purpose` (`menu_item` \| `logo` \| `cover`) → `{ key, url }`. Images only (PNG/JPEG/WebP, sniffed), ≤ 2 MB, storage limit enforced. |
| GET | `/files/:key*` | Serves stored objects. |

## Menu (menu module)

| Method           | Path                                         | Notes                                                                                                                                                                   |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET              | `/restaurants/:restaurantId/menu`            | Full management tree (categories → items → variants, add-on groups). `menu.view`                                                                                        |
| POST             | `/restaurants/:restaurantId/menu/categories` | `{ name, description?, isVisible? }` → category. `menu.manage`                                                                                                          |
| PATCH/DELETE     | `/menu/categories/:categoryId`               | reorder via `sortOrder`                                                                                                                                                 |
| POST             | `/restaurants/:restaurantId/menu/items`      | `{ categoryId, name, description?, price, discountedPrice?, dietary, allergens[], prepTimeMinutes, isAvailable?, isFeatured?, imageKey?, variants?[], addonGroups?[] }` |
| GET/PATCH/DELETE | `/menu/items/:itemId`                        | PATCH accepts full nested replace of variants/add-on groups                                                                                                             |
| PATCH            | `/menu/items/:itemId/availability`           | `{ isAvailable }`                                                                                                                                                       |
| GET              | `/branches/:branchId/menu`                   | Branch-effective menu (overrides applied) for staff ordering. `orders.view`                                                                                             |
| PUT              | `/branches/:branchId/menu/overrides/:itemId` | `{ price?, discountedPrice?, isAvailable? }` (null = inherit). `menu.availability.manage`                                                                               |

## Tables & QR (menu module)

| Method       | Path                         | Notes                                                                         |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| GET/POST     | `/branches/:branchId/tables` | `{ name, capacity, section? }`                                                |
| PATCH/DELETE | `/tables/:tableId`           |                                                                               |
| POST         | `/tables/:tableId/qr`        | Generate or regenerate (revokes the previous active token). → `{ url, svg }`  |
| GET          | `/tables/:tableId/qr`        | Current QR `{ url, svg, createdAt }` (decrypts stored token). `tables.manage` |
| DELETE       | `/tables/:tableId/qr`        | Revoke                                                                        |

## Customer ordering (ordering module, public)

| Method | Path                           | Notes                                                                                                       |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/public/qr/:token`            | Validates token → restaurant branding, branch, table name, menu (branch-effective, available items only).   |
| POST   | `/public/qr/:token/session`    | Join or open the table session; sets `ros_guest` cookie.                                                    |
| GET    | `/public/session`              | Current guest session: table, status, my orders (`GuestOrderDto[]`), bill summary if issued.                |
| POST   | `/public/session/orders`       | `placeOrderSchema` (**idem** via body `idempotencyKey`) → `GuestOrderDto` (PENDING). Requires connectivity. |
| POST   | `/public/session/bill-request` | Marks session BILL_REQUESTED; notifies staff.                                                               |
| POST   | `/branches/:branchId/orders`   | Staff order: `staffPlaceOrderSchema`. `orders.create`                                                       |

## Staff operations (staff-ops module)

| Method | Path                             | Notes                                                                                     |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/branches/:branchId/orders`     | `orderListQuerySchema` → `OrderDto[]`                                                     |
| GET    | `/orders/:orderId`               | `OrderDto` with timeline                                                                  |
| POST   | `/orders/:orderId/transition`    | `orderTransitionSchema`; permission per action; 409 on stale version / invalid transition |
| PATCH  | `/orders/:orderId/priority`      |                                                                                           |
| PATCH  | `/orders/:orderId/items/:itemId` | item-level kitchen status                                                                 |
| GET    | `/branches/:branchId/sessions`   | Active tables + sessions summary (status, orders count, bill state)                       |
| GET    | `/branches/:branchId/events`     | Server-Sent Events: `order.*`, `session.*`, `bill.*` refetch hints                        |
| GET    | `/branches/:branchId/kitchen`    | KDS feed: ACCEPTED/PREPARING/READY (+ recent completed)                                   |

## Billing (billing module)

| Method | Path                                            | Notes                                                                         |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/branches/:branchId/bills/preview`             | `previewBillSchema` → totals without saving                                   |
| POST   | `/branches/:branchId/bills`                     | `generateBillSchema` (**idem**) → `BillDto`. Snapshots lines, taxes, discount |
| GET    | `/branches/:branchId/bills`                     | filter by paymentStatus/date                                                  |
| GET    | `/bills/:billId`                                | `BillDto`                                                                     |
| POST   | `/bills/:billId/payments`                       | `recordPaymentSchema` (**idem**)                                              |
| POST   | `/bills/:billId/refunds`                        | `refundSchema`                                                                |
| POST   | `/payments/:paymentId/void`                     | `voidSchema`                                                                  |
| POST   | `/bills/:billId/void`                           | `voidSchema` (only with no confirmed payments)                                |
| POST   | `/branches/:branchId/sessions/:sessionId/close` | applies closure rules                                                         |
| GET    | `/branches/:branchId/payments/summary`          | `PaymentSummaryDto`                                                           |

## Subscriptions, platform & support (platform module)

| `/public/plans` (GET) · `/public/announcements` (GET) · `/workspaces/:id/subscription` (GET overview + history) · `/workspaces/:id/support` (GET/POST) · `/workspaces/:id/audit` (GET) · `/admin/*` (Super Admin: overview, workspaces, plans, subscriptions, settings, announcements, support, audit) · `/jobs/subscriptions` (POST, `Authorization: Bearer CRON_SECRET`) · `/test/clock` (POST, only with `ENABLE_TEST_HOOKS`) |

## Organizations (platform module)

Billing is owned by the organization (spec section 7.1): one subscription per organization, shared by every workspace in it. Super Admin subscription actions under `/admin/workspaces/:workspaceId/subscription/*` act on that workspace's organization.

| Method | Path                                   | Notes                                                                                                                                                                                                                             |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH  | `/admin/organizations/:organizationId` | `{ maxWorkspacesOverride: number \| null }` → `AdminOrganizationDto`. Per-organization workspace limit that wins over the plan and fair use (null = plan rules). Platform role; audited as `organization.limit_override_changed`. |

## Online payments (payments module)

Prepaid billing periods through the configured gateway (`PAYMENT_PROVIDER=razorpay`; with `none` these routes answer 404). The amount is always the plan's price from the database; the client sends only the plan and cycle. Checkout belongs to the organization (the billing owner) and needs an organization OWNER or BILLING_ADMIN; anyone else gets 404.

| Method | Path                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/organizations/:organizationId/checkout`        | `{ planKey, billingCycle }` → 201 `CheckoutSessionDto` (`keyId`, `orderId`, `amountMinor`, `currency`, plan and organization names). Creates the provider order and a `payment_orders` row; audited `payment.checkout_created`. 422 for a plan that is not public, active or priced for that cycle.                                                                                                                                 |
| POST   | `/organizations/:organizationId/checkout/verify` | Checkout's callback `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }`. 401 on a bad signature. Activates the plan only when the provider also reports a captured payment of the stored amount → `{ status: "ACTIVE" }`; otherwise `{ status: "PENDING" }` (the webhook may still activate). A second call is a no-op.                                                                                                     |
| POST   | `/webhooks/razorpay`                             | Public, cross-origin, no CSRF; `X-Razorpay-Signature` over the raw body is the authentication (401 otherwise, body never logged). `order.paid` / `payment.captured` activate the order once (`subscription_events` type `paid`, audit `subscription.paid`); replays (same `x-razorpay-event-id`), ignored types and unknown orders answer 200. An amount or currency mismatch audits `payment.amount_mismatch` and never activates. |

## Notifications & offline (notifications module)

| `/notifications` (GET list, unread count) · `/notifications/read` (POST ids or all) · `/notifications/preferences` (GET/PUT) · `/push/subscriptions` (POST/DELETE) · `/sync/ping` (GET connectivity probe) |

## Analytics (analytics module)

| `/branches/:branchId/analytics?from&to` · `/workspaces/:id/analytics?from&to&branchId` · `/admin/analytics` |

## Upgrade requests (platform module)

Plan changes use their own request flow (support tickets of category `UPGRADE` are refused with a 422 that points to it). One `PENDING` request per workspace; decided requests are final (`INVALID_STATE_TRANSITION` 409 on a second decision).

| Method | Path                                                   | Notes                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/workspaces/:workspaceId/upgrade-requests`            | Own workspace's requests, newest first (`workspace.subscription.view`). Never includes internal notes.                                                                                                                                                                                                                   |
| POST   | `/workspaces/:workspaceId/upgrade-requests`            | `{ planKey, billingCycle, message? }` → 201 `UpgradeRequestDto` (`workspace.subscription.manage`). 422 if the plan is unknown, not public, or already active; 409 if one is pending.                                                                                                                                     |
| DELETE | `/workspaces/:workspaceId/upgrade-requests/:requestId` | Cancel a pending request of this workspace (another tenant's id → 404).                                                                                                                                                                                                                                                  |
| GET    | `/admin/upgrade-requests?status&search&page&pageSize`  | Super Admin list, pending first; includes `pendingCount`.                                                                                                                                                                                                                                                                |
| GET    | `/admin/upgrade-requests/:requestId`                   | Detail + history (CREATED / NOTE / APPROVED / REJECTED / CANCELLED) + the workspace's current subscription.                                                                                                                                                                                                              |
| POST   | `/admin/upgrade-requests/:requestId/approve`           | `{ billingCycle, periodEnd, note? }`. In one transaction: retires the current subscription, activates the requested plan (same code path as manual activation), marks the request `APPROVED` with approver and time, notifies the owners (`subscription.activated`, in-app + email), audits `platform.upgrade_approved`. |
| POST   | `/admin/upgrade-requests/:requestId/reject`            | `{ reason }` (required). Subscription untouched; owners get `subscription.upgrade_rejected`; audited.                                                                                                                                                                                                                    |
| POST   | `/admin/upgrade-requests/:requestId/notes`             | `{ body }` internal note, visible to Super Admins only.                                                                                                                                                                                                                                                                  |

## Super Admin menu inspection (menu module)

| Method | Path                                                            | Notes                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/workspaces/:workspaceId/restaurants/:restaurantId/menu` | Read-only `AdminRestaurantMenuDto`: workspace, restaurant, its branches, currency, full category → item tree (variants, add-on groups, availability, images) and every branch override. The restaurant must belong to the workspace in the URL (otherwise 404). Never creates a menu. Platform role required (403 otherwise). |
