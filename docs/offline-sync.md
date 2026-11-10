# Offline & sync

Staff devices (waiter phones, kitchen tablets, the manager's laptop) keep working through short
connection drops. This document describes what the code in `packages/web-core/src/features/offline` actually does.

## Principles

- **IndexedDB is per device.** It is a cache and a queue, never shared storage. Other devices
  never see it; the server is the source of truth.
- **Server-authoritative operations are never queued.** Guest (QR) order submission, order
  acceptance/rejection, bill generation, payments, refunds, voids and closing a session always
  need a live response. Offline their buttons are disabled and say why (`NeedsConnectionNote`).
  Only operations that are safe to apply later go through the outbox: kitchen item status and
  start/ready, and staff-entered orders (see [Queued staff operations](#queued-staff-operations)).
  Menu, availability and settings screens do not queue anything today; they need a connection.
- **Nothing queued is shown as confirmed.** A queued change reads "Waiting to sync" (kitchen) or
  "Not sent — will send when online" (staff orders) until the server answered 2xx. Prices and
  order numbers always come from the server response.
- **Permissions are enforced by the server** when the queued request arrives. A change that was
  allowed offline can still be rejected (403/404/422) and is then shown as "Not saved".
- **Nothing pending is silently discarded.** Items leave the outbox only when they synced or when
  the user presses Discard (behind a confirmation).

## Local database (`db.ts`)

Dexie database `restaurantos-staff`, schema version 1 (unchanged by the queued staff operations:
their new fields are not indexed, so no upgrade is needed and rows written by older releases sync
as before; `queued-ops.test.ts` opens a database created with the original schema to check this):

| Table        | Key                    | Contents                                                                                                                |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `queryCache` | `key` (JSON query key) | `queryKey, data, updatedAt, userId` — persisted TanStack queries                                                        |
| `outbox`     | `id`                   | queued mutations (see below)                                                                                            |
| `drafts`     | `${userId}:${key}`     | `value, updatedAt, userId` — form drafts                                                                                |
| `meta`       | `key`                  | `currentUserId` — last server-confirmed user on this device; `signedOutAt` — last sign-out or account switch (epoch ms) |

Outbox item: `id, createdAt, updatedAt, userId, scopeKey, kind, label, method, path, body,
idempotencyKey, expectedVersion?, versionField?, chainVersion?, meta?, status
(pending|syncing|synced|failed|conflict), attempts, nextAttemptAt, lastError, lastErrorCode,
lastStatus, serverResponse?, syncedAt, invalidateKeys?, confirmedAt?`. `meta` holds local-only UI
details (e.g. which order item a change is for) and is never sent. `confirmedAt` is set when the
user explicitly retries or confirms an item (see [stale staff orders](#queued-staff-operations)).

**Shared devices.** When the server confirms a _different_ user than the last one (live
`/auth/me`), the previous user's `queryCache` rows, drafts and synced history are deleted. Their
**unsynced** outbox items are kept but are never sent with another account's session; the sync
sheet shows only a count ("N changes saved by another account") and an explicit Discard. When
the `["me"]` query fails with 401 the whole `queryCache` is cleared (the sync engine's own
session check does not clear it; it only marks "sign in to continue syncing").

**Sign-out.** If the outbox holds unsent changes, signing out first asks "You have N unsent
changes. They will be sent only after you sign in again on this device." Signing out clears the
cache, drafts and stored user, records `signedOutAt`, and resets the device user and the sync
store (items, counts), so the next account neither sees the previous one's items nor queues
under it. The unsynced items stay in IndexedDB, hidden and counted as another account's.

## Public API (`@/features/offline`)

```ts
import {
  enqueueMutation,
  useOfflineDraft,
  OfflineDataNotice,
  SyncStatusIndicator,
  OfflineBanner,
} from "@/features/offline";

// Draft-able operations ONLY (normally built by queued-ops.ts).
await enqueueMutation({
  kind: "kitchen.transition",
  label: "#12 · start cooking", // shown to the user, be specific
  method: "POST",
  path: `/orders/${order.id}/transition`, // relative to /api/v1
  body: { action: "start" },
  scopeKey: `order:${order.id}`, // ordering unit (see FIFO)
  expectedVersion: order.version, // optional, sent as body.version (or versionField)
  versionField: "expectedVersion",
  invalidateKeys: [["staff-ops", branchId]], // refetched after it synced
});
```

- Returns the stored `OutboxItem` immediately and starts a sync when online. Update the UI
  optimistically yourself (e.g. `queryClient.setQueryData`) and label it as "waiting to sync".
- Use endpoints that declare `idempotency` in `route()` or are naturally idempotent (PUT, or
  PATCH with `version`). The same `Idempotency-Key` is sent on every attempt; `route()` replays the
  stored response for repeats.
- `expectedVersion` is merged into the JSON body as `version` (this API's optimistic-concurrency
  convention), so a stale edit returns 409 `STALE_VERSION` instead of overwriting. Endpoints
  that call the field differently set `versionField` (orders use `expectedVersion`).
- `idempotencyKey` (optional) reuses a key the caller already owns instead of generating one,
  e.g. the body `idempotencyKey` of an order draft. Header and body then carry the same key on
  every attempt.
- `chainVersion: true` is for scopes that edit **one** record whose new `version` comes back in
  the response (`order:<id>`). When an item synced, later pending items of the scope that were
  made on the same version are rebased on the returned one, so a chain of offline changes to one
  order doesn't conflict with itself. The version is resolved again when an item is sent: the
  higher of its own and the newest version this device's earlier answered changes of the scope
  got back. So a quick second tap stored only after the first one was answered (the rebase never
  saw it), and taps queued behind one the user resent with **Retry with latest**, are not a
  second 409. A real concurrent change still conflicts: only this device's answers are followed.

`useOfflineDraft(key, initial)` → `{ value, setValue, clear, restored, savedAt, ready }`. Values
are saved per user and device (debounced 400 ms) and restored on the next mount. Call `clear()`
after a successful submit. Drafts never reach the server on their own.

`<OfflineDataNotice updatedAt={query.dataUpdatedAt} refetchFailed={query.isRefetchError} />`
renders "Offline — showing saved data from 5 minutes ago" when the device is offline (or the last
refetch failed) and nothing otherwise.

`<SyncStatusIndicator />` — compact pill (Online / Offline / "3 waiting to sync" / spinner while
syncing / red "2 need attention"). Opens a sheet listing every outbox item with label, status,
attempts, last error and time, plus Sync now, Retry, Retry with latest (conflicts) and Discard.

`useIsOffline()` / `<NeedsConnectionNote>Recording a payment needs a connection.</NeedsConnectionNote>`
— disable a server-authoritative control while offline and show why (the note renders nothing
online).

`<OfflineBanner />` — thin bar shown only while offline: what keeps working and that order
acceptance, bills and payments need a connection.

Both are exported only; shells decide where to mount them.

## Query persistence (`persist-queries.ts`)

A small custom persister over Dexie (no extra dependency):

- Persisted: `["me"]`, `["branch", id, "context"]`, `["workspace", id, "structure"]` and any query
  with `meta: { persist: true }` (the notification bell uses this).
- Successful **network** results are written with the server-confirmed user id: the first result
  of each query on a page load at once (a screen that loses its connection or is reloaded right
  after it loaded still has its data), later ones debounced 300 ms. Pending debounced writes are
  flushed when the tab is hidden. Results put in with `setQueryData` are not written back.
- On startup the last confirmed user's rows (max 7 days old) are restored with
  `setQueryData(key, data, { updatedAt })` and then invalidated without a refetch, so they are
  stale even when saved seconds before a reload (within `staleTime`) and the screen refetches
  them as soon as the network allows. Fresher in-memory data is never overwritten.
- Restoring is asynchronous (IndexedDB), right after the providers mount. While offline,
  TanStack queries are paused (`networkMode: "offlineFirst"`), so views show their loading state
  for a moment and then the restored data.

## Queued staff operations

`queued-ops.ts` builds the outbox entries; feature code calls `enqueueMutation(builder(...))`.
**The kitchen screen always queues, online too.** Item status and start/ready go through the
outbox, which sends one order's changes strictly in order: each one after the previous one
resolved, and on the version it returned (`chainVersion` rebase). A direct request per tap had
no such ordering and no version: two quick taps could resend the first step (the line stayed
"preparing"), or toggle a ready line back from a stale screen. A tap on stale data now gets a
409 and becomes a conflict instead.

The waiter's staff orders queue when the device is offline **or** the table still has unsynced
items (so a new order never overtakes queued ones). Online, with nothing queued, the direct
request is used: it carries an idempotency key, so a retry or double submit creates one order.

| Operation (builder)                                 | Request                                         | Scope             | Duplicate / conflict handling                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitchen item status (`kitchenItemStatusMutation`)   | `PATCH /orders/:id/items/:itemId` `{ status }`  | `order:<id>`      | Sends `expectedVersion` (order version seen) with `chainVersion`. Route declares `idempotency` (resend replays the first answer); an item already at the target status is a no-op 200. 409 `STALE_VERSION`/`INVALID_STATE_TRANSITION` → conflict                                                                                                  |
| Kitchen start / ready (`kitchenTransitionMutation`) | `POST /orders/:id/transition` `{ action }`      | `order:<id>`      | Same as above. **Retry with latest** resends against the version the conflict reported (`error.details.version`), because the endpoint requires one. A conflict without a version (e.g. `INVALID_STATE_TRANSITION` on a cancelled order) offers only **Discard** (`canRetryWithLatest`)                                                           |
| Staff-entered order (`staffOrderMutation`)          | `POST /branches/:id/orders` (`staffPlaceOrder`) | `table:<tableId>` | Body `idempotencyKey` generated once per draft (dialog session) and reused as the outbox key on every retry; the server answers 201 (new) or 200 (replay) and creates at most one order per key. A network error on a live submit queues the same draft. Body `expectedSessionId` binds the order to the table session the waiter saw (see below) |

- The kitchen ticket shows the server status plus a "Waiting to sync" badge (per item and per
  ticket); a queued item is never drawn as done and "Ready"/"Waiting for pickup" appear only
  once the server says so. Refused changes show "A change to this ticket was not saved".
- Between a change being confirmed and the kitchen feed being refetched, the ticket shows the
  order the server returned (`withConfirmedKitchenChanges`: its version, status and line
  statuses, only while newer than the feed). So the next tap builds on what the server has, never
  on the stale feed.
- Waiter accept/reject/serve and cashier payments are never queued. They send the order version
  or an idempotency key, are disabled while pending, and a 409 shows "already handled" and
  refetches.
- The table drawer lists unsent staff orders as "Not sent — will send when online" with the
  item summary and no price; the server's order (with server prices) replaces it after a 2xx.
- The kitchen feed, branch orders, table sessions, session detail and the branch menu are
  persisted queries, so a reloaded staff screen keeps its data and a waiter can compose orders
  offline from the last menu the device loaded. Without a saved menu the dialog says so.
- **Session binding.** A staff order carries `expectedSessionId`: the open session of the table
  when the order was composed, or `null` when the table was free. If the table's current session
  differs when the request arrives (a session is open but `null` was expected, or the expected
  session closed so a new one would be opened), the server refuses it with 409 `CONFLICT`,
  `details: { reason: "SESSION_CHANGED", currentSessionId }`, and opens no session. Replays of an
  order that was already created still return it. **Retry with latest** resends the order to
  `currentSessionId` (or `null`, opening a session) with a new idempotency key. Callers that omit
  `expectedSessionId` get no check.
- **Stale staff orders.** A queued staff order composed more than 10 minutes ago
  (`STAFF_ORDER_MAX_AGE_MS`), or queued before a sign-out / account switch on this device, is
  not sent automatically. The engine moves it to `conflict` with `lastErrorCode
NEEDS_CONFIRMATION` and the prompt "This order was composed N minutes ago. Send it now?"; the
  sync sheet offers **Send now** (a retry, which records `confirmedAt`) or **Discard**. The rule
  lives in `staffOrderHoldReason` (`queued-ops.ts`).
- Selectors: `queuedKitchenState(items, orderId)`, `queuedStaffOrders(items, tableId)`,
  `scopeHasUnsynced(items, scopeKey)` over `useSyncStore((s) => s.items)`.

## Sync engine (`sync-engine.ts`)

A framework-free class with injectable `db`, `fetch`, clock, randomness and lock.

- **FIFO per `scopeKey`.** Items of one scope are sent strictly in creation order. An item that is
  not yet synced (backing off, failed or in conflict) blocks the rest of its scope until it is
  resolved. Different scopes run in parallel. Pick a narrow scope (e.g. `menuItem:<id>`) for
  changes that don't depend on each other.
- **Session check.** Before sending, the runtime asks `/api/v1/auth/me` who the session cookie
  belongs to. If it is not the item's user, nothing is sent. A successful check (or a live
  `/auth/me` answer of the page for the confirmed user) is reused for 30 s
  (`SESSION_CHECK_TTL_MS`), so an online tap costs one round trip, not two. It is forgotten on any
  401 (check or send), at sign-out or a user change, on `online` and when the tab becomes visible. A failed check (401, 5xx, offline)
  backs off 1 s, 2 s, 4 s … up to 5 min before the next check; `online`, the tab becoming
  visible, manual **Sync now** and any successful `/auth/me` answer reset it. While the session
  is expired (401) no wake-up is scheduled at all; signing in again restarts syncing.
- **Response handling**

  | Response                                                      | Result                                                                                                                                                                                                                         |
  | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 2xx                                                           | `synced` (response `data` kept in `serverResponse`), `invalidateKeys` refetched                                                                                                                                                |
  | network error, timeout (30 s), 408, 429, 5xx                  | stays `pending`, retried with backoff (`Retry-After` honoured). A network error stops the run.                                                                                                                                 |
  | 401                                                           | stays `pending`, the run stops, "Sign in to continue syncing" is shown                                                                                                                                                         |
  | 409 `STALE_VERSION` / `CONFLICT` / `INVALID_STATE_TRANSITION` | `conflict`: kept with the server message. The user picks **Retry with latest** (resend without the version check, or against the server's current version for `chainVersion` items, with a new idempotency key) or **Discard** |
  | other 4xx (422 validation, 403, 404, `IDEMPOTENCY_MISMATCH`)  | `failed`: kept until the user retries or discards it. Never deleted automatically                                                                                                                                              |

- **Backoff:** 1 s, 2 s, 4 s, 8 s … capped at 5 min, ±20 % jitter.
- **Crash recovery:** an item left in `syncing` for over 1 minute (tab closed mid-request) goes
  back to `pending` and is resent with the **same** idempotency key.
- **Multiple tabs:** a run takes the Web Lock `restaurantos-outbox-sync` (`ifAvailable`, so other
  tabs skip the run). Without Web Locks, each item is still claimed atomically
  (`pending → syncing` inside an IndexedDB transaction), so two tabs never send the same item at
  once; idempotency keys cover the rest. The UI follows changes from all tabs through Dexie
  `liveQuery`. _Deviation from the original plan:_ no BroadcastChannel leader election is
  implemented. The atomic claim makes it unnecessary.
- **Retention:** synced items stay in "Recently synced" for 24 h (max 50), then are pruned.

### When sync runs

On startup, on the `online` event, when the tab becomes visible, every 30 s while offline or
while items are waiting, when a backed-off item is due, right after `enqueueMutation`, and on
manual **Sync now** (which ignores backoff timers). Each trigger first probes
`GET /api/v1/sync/ping` (public, `no-store`) because `navigator.onLine` can say "online" on dead
Wi-Fi. The `online` event often fires before the network carries traffic, so a probe that fails
with a network error while the browser reports a connection (an HTTP error answer counts as
reachable) is repeated after 1, 2, 4 and 8 s (`REPROBE_DELAYS_MS`), once per `online` event or
startup; after that the 30 s interval takes over. Background Sync API is not used.

## Service worker (`apps/console/src/app/sw.ts` and `apps/ops/src/app/sw.ts`, Serwist 9)

- **Registered on staff routes only** (`StaffOffline`, `packages/web-core/src/staff-offline.tsx`):
  console `/app/**` and `/print/**` and every ops route. Public, sign-in and guest QR pages never
  register it (no precache download for them). The scope is still `/`: a worker installed by an
  earlier version, or by a staff visit on the same origin, keeps controlling every page of that
  origin and keeps updating itself, so returning visitors still get its runtime caching.
- Precache (build manifest + `/~offline`), `skipWaiting`, `clientsClaim`, navigation preload.
- `/api/**` → **NetworkOnly**. The worker never caches API responses. Data for offline use lives
  in IndexedDB.
- Customer pages `/t/*`: navigations NetworkFirst (5 s timeout, cache `customer-pages`, 24 h),
  and `/_next/static/**` cache-first. This applies only where a worker is already installed (see
  above): a new guest's phone gets no worker, so the QR menu shell is not cached for them.
  Ordering always needs the network.
- Everything else uses Serwist's `defaultCache` for Next.js.
- First page of a tab (`cache-current-page.ts`): it loads before the worker controls the tab, so
  `cacheOnNavigation` never sees it. `OfflineRuntime` sends it to the worker with `CACHE_URLS`
  when it is a staff screen (`/app/**` in the console; `/waiter`, `/kitchen`, `/cashier` in ops)
  without a token in its query and no cache holds it yet. It lands in Serwist's `others` cache
  (NetworkFirst, 32 entries, 24 h), keyed by URL only. At sign-out every cached staff page is
  removed from `others`, `pages`, `pages-rsc` and `pages-rsc-prefetch` (`purgeCachedStaffPages`,
  best effort). Public, auth,
  invite and guest pages are never cached this way; the guest's first `/t/<token>` page is not
  reloadable offline (out of scope: ordering needs the network anyway).
- **Frontend HTML must stay user-agnostic.** Pages are cached per URL (public pages across
  sign-outs and accounts), which is safe only because every page is a client shell: all user and tenant data
  comes from the API into per-user IndexedDB. Never render user data on the server in a page
  (no `cookies()`/`headers()` in console or ops pages).
- Navigation fallback: `/~offline`. It explains what works offline and shows the number of unsynced
  changes, read from IndexedDB.
- `push` / `notificationclick` handlers are present but only receive messages when a push provider
  is configured (the default noop provider sends nothing). Click targets are restricted to same-origin paths.
- In development the worker is disabled (`SerwistProvider disable`). Test it with
  `pnpm build && pnpm start`.
- `pnpm-workspace.yaml` overrides `browserslist` to a single version. With two versions pnpm
  installed two peer variants of `serwist`, both were bundled into the worker, Serwist's
  `instanceof Strategy` check failed for `defaultCache` routes, the `/~offline` fallback was
  never attached to the route that serves page navigations, and offline navigations ended in
  `ERR_FAILED`. `pnpm why serwist` must show one copy.

## What works offline, per role

| Role            | Works offline                                                                                                                                                | Needs a connection (disabled offline, reason shown)                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner / manager | Previously opened dashboards, workspace structure, branch context (read-only); everything the waiter and kitchen rows list                                   | Menu, availability and settings changes, creating restaurants/branches, staff invites, billing, subscription, and the waiter/cashier rows' list |
| Waiter          | Saved orders, tables and menu. **Composing staff orders** (queued per table, "Not sent — will send when online", sent once with the draft's idempotency key) | **Accepting/rejecting** (and serving/cancelling) orders, generating bills                                                                       |
| Kitchen         | Saved kitchen feed. **Item status and Start / Mark ready** (queued per order with the order version, "Waiting to sync"; conflicts kept for the user)         | Nothing else on the kitchen screen                                                                                                              |
| Cashier         | Saved queue and bills (read-only)                                                                                                                            | **Generating bills, recording payments**, refunds, voids, closing tables                                                                        |
| Customer (QR)   | Only with a worker already installed on that device (see Service worker): the cached `/t/*` page shell and assets. A new guest gets no offline shell.        | Viewing live menu data, placing orders (submit says it is not sent), requesting the bill                                                        |

Feature modules add to the "works offline" column only by using `enqueueMutation`,
`useOfflineDraft` or `meta: { persist: true }`.

## Notifications

In-app notifications (`/api/v1/notifications*`) are written by modules inside their own
transaction (`repositories/notifications.ts`). The bell polls every 30 s and on window focus, and
its last result is persisted for offline display. Browser push is optional: `/api/v1/push/config`
returns `{ enabled: false }` with the noop provider, and no opt-in button is rendered then.

## Limitations

- Restoring persisted queries is asynchronous, so there is a brief loading state before cached
  data appears offline.
- Only the last server-confirmed user's cache is restored. A brand-new device (or a new user)
  has nothing cached until it has been online once.
- "Retry with latest" re-applies the queued body without a version check. That is
  last-writer-wins by explicit user choice, not a field-level merge.
- A strictly ordered scope is blocked by a failed/conflicting head item until the user acts.
  Choose scopes accordingly.
- A queued "Mark ready" after queued item changes that already make every item ready would
  conflict (the server auto-readies the order); the ticket hides that button in that case.
- Two devices changing the same order offline: whichever syncs second gets a conflict and
  its user decides (retry against the latest version, or discard). No field-level merge.
- While a table has unsent staff orders (waiting, failed or in conflict), the waiter's
  **Generate bill** is disabled ("N orders not sent yet — resolve them first"), so a bill never
  silently leaves them out. This only sees this device's outbox.
- Shared devices: an unsent staff order saved by another account stays hidden (only counted in
  the sync sheet) and is not sent or shown on its table until that user signs in again. The next
  user's bill gate does not see it, so they **can** bill and close the table around it. When the
  owner signs in again the order is held for "Send now?" (queued before a sign-out), and even if
  sent, the server's session check refuses it (409 `SESSION_CHANGED`) instead of adding it to a
  billed session or opening a phantom one.
- Persisted data is not encrypted at rest. It relies on the device/browser profile. It is
  cleared on user change, on explicit sign-out and when the `["me"]` query gets a 401.
- iOS Safari may evict IndexedDB for sites not added to the home screen after a period of no use.
