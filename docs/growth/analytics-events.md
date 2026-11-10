# Growth measurement with Google Analytics 4

How RestaurantOS measures acquisition and product adoption with Google Analytics 4 (GA4), what it never sends, and which numbers must come from the database instead. GA4 and the Measurement Protocol are free for a standard property; nothing here needs a paid plan.

**Status:** built and tested, **inert until configured**. No GA4 property exists yet. With no Measurement ID the console renders no banner, loads no script and makes no request to Google, and the API sends nothing (`TRACKING_PROVIDER=none`). The [setup steps](#manual-ga4-setup) at the end turn it on.

> **Release gate.** Do not set `GA_MEASUREMENT_ID` in any environment until that environment's web stream has **Enhanced measurement switched off** and the [gate check](#0-release-gate-enhanced-measurement-off) has passed on staging. GA4 turns Enhanced measurement on for every new web stream; while it is on, the tag sends its own page views and click, search and form events with raw URLs (invitation tokens, workspace ids) that our sanitizer never sees. The code cannot enforce this setting.

## Decisions at a glance

| Question                      | Decision                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent model                 | Opt-in. gtag.js is not loaded, and `window.dataLayer` does not exist, until the visitor presses **Allow analytics**. This is Google's _basic_ consent mode ("Google tags blocked until consent is granted", [About consent mode][consent-about]).                                                                                                        |
| Consent Mode v2               | Every type (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`) defaults to `denied` as the first command; only `analytics_storage` is ever updated to `granted`. Advertising stays denied for good, `ads_data_redaction` is on.                                                                                                    |
| Which apps                    | The console only (public site, sign-up, owner dashboard). Ops (kitchen screens and shared counter devices) and admin (internal) do not mount it. Each frontend reads `GA_MEASUREMENT_ID` from its own runtime environment, so enabling another app is one line.                                                                                          |
| Guest QR pages (`/t/<token>`) | Never measured in GA4: no banner, no tag, no cookie. Diner and kitchen events (`qr_menu_viewed`, `order_submitted`, `order_accepted`, `order_completed`) are database-derived (see [why](#why-diner-and-kitchen-events-are-not-in-ga4)).                                                                                                                 |
| Page views                    | Manual: `send_page_view: false`, one `page_view` per route change from our code, enhanced measurement **off** on the stream. This is the only way to strip tokens and tenant ids from every URL GA4 sees.                                                                                                                                                |
| Marketing vs product          | One web stream per environment; GA4's built-in `content_group` is `marketing`, `auth` or `product` on every page view and event, so acquisition and product use are separated without breaking the visitor → sign-up journey across two streams.                                                                                                         |
| Server-authoritative events   | `trial_started`, `payment_succeeded`, `subscription_activated` are sent by the API through the Measurement Protocol after the database transaction commits, once per transition, **and only for a person who opted in**. There are no anonymous server events.                                                                                           |
| Consent for server events     | A request counts as opted in only if it carries `ros_analytics_consent=granted` and a valid `_ga` cookie (the console's `/api/v1` proxy forwards cookies). A webhook has no browser: the client id stored with the checkout, kept only if the buyer opted in at checkout, decides. Super Admin actions (manual activation, cancellation) are never sent. |
| Revenue and funnel truth      | Revenue, trials, paid conversions, activation and retention come from the database. GA4 is for acquisition source, page-level drop-off and on-site behaviour of visitors who opted in.                                                                                                                                                                   |

## Architecture

```
 Browser (console)                                  API                                   Google
 ─────────────────                                  ───                                   ──────
 root layout ─ <Tracking/> (server, reads GA_MEASUREMENT_ID at request time)
   └─ TrackingLoader (client, tiny) ── next/dynamic, only with an ID ──▶ TrackingClient (own chunk)
        ├─ ConsentBanner ── Allow ──▶ cookie ros_analytics_consent=granted
        ├─ configureGtag()  consent default denied → update analytics granted → config
        ├─ <Script gtag.js>  ───────────────────────────────────────────────────────────▶ googletagmanager.com
        ├─ trackPageView()   one page_view per pathname, sanitized URL ─────────────────▶ *.google-analytics.com
        ├─ startApiTracking()  api-client onApiSuccess → server-confirmed events
        └─ track()/trackOnce()/useTrackOnMount()  UI events (sign-up focus, upgrade dialog)

 fetch /api/v1/* ── console proxy (forwards Cookie) ──▶ route() → RequestMeta.analytics
                                                       (client id + session id, only with consent cookie,
                                                        only while TRACKING_PROVIDER is not none)
                                                    checkout: payment_orders.analytics_client_id = consented id or null
                                                    services emit after commit, only with ids ─▶ ServerTracking port
                                                       ├─ none   (default)
                                                       ├─ memory (tests)
                                                       └─ ga4    Measurement Protocol, 2 s timeout ───────▶ www.google-analytics.com/mp/collect
```

| Piece                                                                                                                                             | File                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Event catalog (names, strict hand-written param rules, source, key event), PII guard; consent cookie name; plan-key rule shared with the platform | `packages/contracts/src/tracking-events.ts`, `analytics-consent.ts`, `plan-key.ts`                                                                                                                           |
| Browser tracker                                                                                                                                   | `packages/web-core/src/tracking/` (`tracking.tsx`, `tracking-client.tsx`, `consent.ts`, `consent-banner.tsx`, `gtag.ts`, `track.ts`, `page-views.ts`, `api-events.ts`, `sanitize.ts`, `privacy-choices.tsx`) |
| Server port                                                                                                                                       | `packages/application/src/ports/server-tracking.ts`                                                                                                                                                          |
| Adapters                                                                                                                                          | `packages/adapters/src/tracking/providers/ga4-measurement-protocol.ts`, `memory.ts` (`none` is `noServerTracking` in the port)                                                                               |
| Composition                                                                                                                                       | `apps/api/src/composition/container.ts` (`selectTracking`), `payments.ts`, `workspaces.ts`                                                                                                                   |
| Request attribution                                                                                                                               | `packages/application/src/http/route.ts` (`RequestMeta.analytics`)                                                                                                                                           |
| Opt-in carried to a webhook                                                                                                                       | `payment_orders.analytics_client_id` (migration `0008_payment_order_analytics_opt_in`, down script in `migrations-down/`)                                                                                    |
| "Cookie settings" placements                                                                                                                      | `site-footer.tsx` (public site), `auth-shell.tsx` (auth pages), `profile-menu.tsx` (account menu: every dashboard and the account page)                                                                      |

The owner-facing product dashboard in `packages/web-core/src/features/analytics` is unrelated: it shows a restaurant its own sales from the database and sends nothing to Google.

### Bundle cost on every page

The tracker is in the root layout and "Cookie settings" is in the site footer, so their eager imports ship to every console page, the marketing site and guest QR pages included. To keep that small:

- The catalog's runtime rules are hand-written descriptors, not zod; full zod alone is about 34 KB gzip. The rules are equally strict: unknown keys, missing required keys, wrong types and out-of-range values are refused, and the PII checks are unchanged. A test checks the plan-key rule against the platform's `planKeySchema`.
- `TrackingClient` (banner, gtag set-up, page views, the API observer) is its own chunk, loaded by a tiny `TrackingLoader` only when a Measurement ID is configured.
- The footer link imports only the consent store and the cookie name; the account-menu item, which needs the dropdown menu, lives in `privacy-choices-menu.tsx`.

`web-core/src/tracking/client-bundle.test.ts` walks the import graph and fails if any browser tracking code reaches zod, or if the eager part grows beyond the loader, the footer link, the consent store and the cookie-name module. Measured first-load JS of `/features` (gzip, from the build manifests, `scripts/perf/bundles.mjs`): 254.3 KB before, 203.4 KB after, 201.2 KB with tracking removed entirely.

### Why API-confirmed client events

`signup_completed`, `login_completed`, `workspace_created`, `restaurant_created`, `branch_created`, `menu_item_created`, `qr_generated` and `checkout_started` fire from one observer on the shared API client (`onApiSuccess` in `packages/api-client`) when the API answered 2xx to the matching `POST` (table in `api-events.ts`). They therefore count what the server accepted, from every screen that can do it (dialogs, the onboarding wizard, later screens), with no per-screen code to forget. A unit test checks every template against a real `route.ts` exporting `POST` under `apps/api/src/app/api/v1`, so a renamed API route fails CI instead of silently losing an event. The observer reads the response body only for the checkout's plan key, cycle and list price.

## Configuration per environment

Every value is read at runtime; nothing is baked into an image. Frontends never get a `NEXT_PUBLIC_` variable. On staging, `infra/gcp/deploy.sh` sets all of them from operator variables (`STAGING_GA_MEASUREMENT_ID`, `STAGING_GA_ENHANCED_MEASUREMENT=off`, the `ros-staging-ga-api-secret` secret); see [step 4](#4-environment-variables).

| Variable            | Service              | Default | Purpose                                                                                                                                                                                                                                       |
| ------------------- | -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GA_MEASUREMENT_ID` | console              | unset   | This environment's GA4 web stream (`G-…`). Unset or malformed: tracking is inert.                                                                                                                                                             |
| `GA_DEBUG_MODE`     | console              | unset   | `true` adds `debug_mode` to the config so events appear in GA4 DebugView. Staging only.                                                                                                                                                       |
| `TRACKING_PROVIDER` | api                  | `none`  | `none` sends nothing; `ga4` sends server events through the Measurement Protocol.                                                                                                                                                             |
| `GA_MEASUREMENT_ID` | api                  | unset   | Must equal the console's value in the same environment so server events join the browser's data. Also needed to read the session cookie. Malformed: refused at startup with `ga4`, ignored (warning `ga_measurement_id_ignored`) with `none`. |
| `GA_API_SECRET`     | api (Secret Manager) | unset   | Measurement Protocol API secret of that stream. With `ga4`, startup fails unless both are set. Never logged, never sent to a browser.                                                                                                         |

| Environment        | console `GA_MEASUREMENT_ID`                                       | api `TRACKING_PROVIDER` / `GA_MEASUREMENT_ID` / `GA_API_SECRET` |
| ------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Local dev, CI, E2E | unset (CI's consent E2E step: fake `G-E2ETEST01`, Google stubbed) | `none` / unset / unset                                          |
| Staging            | staging stream `G-…`                                              | `ga4` / staging stream / staging secret                         |
| Production         | production stream `G-…`                                           | `ga4` / production stream / production secret                   |

**Staging never pollutes production:** use two separate GA4 properties, not two streams in one property. The production ID and secret exist only in the production services' environment and Secret Manager entries; staging services are configured with the staging property. Tests use the memory adapter and a fake `G-E2ETEST01` id with every request to Google stubbed.

## Privacy rules (India DPDP Act)

1. **Notice and choice before any processing.** The banner explains what is collected and links to the privacy policy (cookies section updated). **Decline** and **Allow analytics** are the same size, style and weight; ignoring the banner means no analytics. Nothing about the visitor goes to Google before Allow.
2. **Withdrawal as easy as consent, everywhere consent can be given.** "Cookie settings" reopens the banner showing the current choice from the site footer, the auth pages' footer and the account menu (every dashboard and the account page), and moves keyboard focus to the banner's heading (the account menu does not pull focus back to its trigger); the banner's first appearance never takes focus. Consent is per browser: withdrawing in one browser does not change another browser or device, and the policy says so. Declining sets `window['ga-disable-<ID>'] = true`, updates `analytics_storage` to `denied`, and deletes `_ga` / `_ga_<container>` on this host and every parent domain. Stale GA cookies are also deleted whenever the stored choice is not `granted`. **Other open tabs stop at once:** the choice is announced on a `BroadcastChannel` (`ros-analytics-consent`) and every tab re-reads the cookie when it is shown again; until then `track()` and page views check the cookie itself, so a declined tab sends nothing and, with the tag disabled and storage denied, writes no GA cookie.
3. **Choice is remembered** in the first-party cookie `ros_analytics_consent` (`granted` | `denied`, 180 days, `SameSite=Lax`, `Secure` on HTTPS). After 180 days the visitor is asked again. GA cookies use the same 180-day lifetime and are host-scoped (`cookie_domain: "none"`), so ops and admin subdomains never receive them.
4. **No personal data, no tenant data.** The catalog's parameters are enums, booleans, bounded numbers and plan keys (validated with the platform's own `planKeySchema`). TypeScript rejects an unknown key such as `email`; at runtime `validateTrackingEvent` drops events with unknown keys or with string values that look like an email, phone number, UUID, JWT or token (a 24+ character run with digits or capitals; for plan keys only a 10-digit run counts as a phone number and the token check is skipped, since they are already slugs). No `user_id`, `user_data`, IP override, restaurant name, workspace id or payment id is ever sent.
5. **URLs are sanitized** before GA4 sees them (`sanitize.ts`): `/t/<token>` → `/t/:token`, `/invite/<token>` → `/invite/:token`; under `/app` only known route words (`PRODUCT_SEGMENTS`) survive and everything else becomes `:id`; elsewhere only known public route words (`PUBLIC_SEGMENTS`) survive, UUIDs and numbers become `:id` and anything else (a future tenant slug, a token, a mistyped URL) `:redacted`. Tests walk the route tree so both lists stay complete. The query string keeps only `utm_*` tags (themselves screened); fragments are dropped. `page_title` is always the sanitized path, never `document.title` (titles can name a restaurant and can lag a client navigation); external referrers are reduced to their origin.
6. **No advertising.** Google signals and ad personalization signals are off in the tag; Measurement Protocol requests send `consent.ad_user_data` and `consent.ad_personalization` as `DENIED`. GA4 does not log or store IP addresses ([GA4 IP handling][ga-ip]).
7. **Diners are never tracked by GA4** (no banner on `/t/*`, the tag never loads there even for a device that opted in elsewhere). The same holds after a **client navigation** into an unmeasured route (`/t/*`, `/print/*`, dev pages) from a page where gtag.js is already loaded: the tracker sets `ga-disable-<ID>` and `analytics_storage: denied` there, so the tag itself sends nothing and writes no cookie even if Enhanced measurement were on. Returning to a measured page switches it back on and counts a new `page_view`. The visitor's stored choice is not changed.
8. **Server events only for people who opted in.** `trackSafely` sends nothing without the person's GA ids, and both adapters refuse an event without them (`no_consent`). The ids come from the request only when its consent cookie is `granted` (read only while `TRACKING_PROVIDER` is not `none`). For a payment confirmed by the Razorpay webhook (no browser in the request), the checkout stored the buyer's client id in `payment_orders.analytics_client_id` **only if they had opted in at checkout**. It is **used only within 48 hours of the checkout**, and that limit is enforced in code: verify and the webhook ignore an older id and delete it (with any other over-age ones) when they touch the order, whatever the outcome. It is cleared in the activating transaction, and the hourly cleanup run (`POST /api/v1/jobs/subscriptions`, result `analyticsIdsCleared`, run first and in its own `try/catch` so a failing subscription sweep cannot skip it) deletes it from any checkout older than 48 hours that was never paid. 48 hours is longer than Razorpay retries a webhook. The cleanup only bounds how long an unused id stays stored; if the job is not scheduled ([step 4b](#4b-schedule-the-cleanup-run-hourly)) nothing is ever sent from an over-age id, but it is not deleted until something touches the order. The verify call always uses the browser's current choice, so a buyer who declined after checkout is not reported from it; the one residual case is a buyer who withdraws between checkout and a webhook-first confirmation (documented in the privacy policy). Super Admin actions are never sent: there is no consented browser of the customer behind them, and the admin's own consent is not the customer's.
9. **The privacy policy says exactly this** (`features/site/legal/privacy.tsx`, sections "How we use data", "Cookies and on-device storage", "Who we share data with"): necessary vs optional cookies, the consent cookie and the tab-session marker, that the choice is per browser, what the browser sends, what Google Analytics collects by default (device and browser type, operating system, screen size, language, approximate location derived from the IP), what the servers send and that the checkout id is used only within 48 hours and deleted when paid or by the next cleanup run, what is never sent, retention, withdrawal per browser, and Google as a recipient outside India. **It needs legal review before launch.**

### Why diner and kitchen events are not in GA4

A guest scanning a table QR code is ordering food, not evaluating our software. Asking every diner for analytics consent would add friction to the core flow; tracking them without consent is not acceptable; and anonymous server-side pings per menu view would put an outbound call to Google on the busiest public endpoint while inflating GA4's user counts with one-off ids. The events GA4 would carry are also tenant operational data. The database already holds exact, per-workspace facts for them:

| Event             | Source of truth                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_submitted` | `orders` (`source = 'CUSTOMER'` for QR orders, `created_at`)                                                                                                                                                                |
| `order_accepted`  | `order_status_history` where `to_status = 'ACCEPTED'`                                                                                                                                                                       |
| `order_completed` | `order_status_history` where `to_status = 'COMPLETED'`                                                                                                                                                                      |
| `qr_menu_viewed`  | **Not recorded today.** Proxy: `table_session_members.joined_at` (a guest device joined a table session, which happens at its first order). A cookieless first-party daily counter per branch is the recommended follow-up. |

They are in the catalog with `source: "database"` so the names are reserved and `track()` cannot send them.

## Event specification

`content_group` (`marketing` / `auth` / `product`) is attached to every browser event through `gtag('set')` and to every server event. Key events are marked in GA4 Admin ([steps](#5-key-events)).

| Event                                                                    | Trigger                                                                                                                                                                                                                                            | Source                           | Parameters                                                                                                                                                                             | Key event |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `page_view`                                                              | Every pathname change on a measured route, once                                                                                                                                                                                                    | client                           | `page_location`, `page_referrer`, `page_title` (sanitized), `content_group`                                                                                                            | no        |
| `landing_page_view`                                                      | First page view of a tab session (after opt-in) when it is a public-site page                                                                                                                                                                      | client                           | `landing_page` (sanitized path)                                                                                                                                                        | no        |
| `signup_started`                                                         | First focus inside the sign-up form, once per page load                                                                                                                                                                                            | client                           | `invited` (sign-up came from an invitation link)                                                                                                                                       | no        |
| `signup_completed`                                                       | `POST /auth/signup` answered 2xx                                                                                                                                                                                                                   | client (server-confirmed)        | `method: "password"`, `invited`                                                                                                                                                        | **yes**   |
| `login_completed`                                                        | `POST /auth/signin` answered 2xx                                                                                                                                                                                                                   | client (server-confirmed)        | `method: "password"`                                                                                                                                                                   | no        |
| `workspace_created`                                                      | `POST /workspaces` answered 2xx                                                                                                                                                                                                                    | client (server-confirmed)        | none                                                                                                                                                                                   | no        |
| `restaurant_created`                                                     | `POST /workspaces/:id/restaurants` answered 2xx                                                                                                                                                                                                    | client (server-confirmed)        | none                                                                                                                                                                                   | no        |
| `branch_created`                                                         | `POST /restaurants/:id/branches` answered 2xx                                                                                                                                                                                                      | client (server-confirmed)        | none                                                                                                                                                                                   | no        |
| `menu_item_created`                                                      | `POST /restaurants/:id/menu/items` answered 2xx                                                                                                                                                                                                    | client (server-confirmed)        | none                                                                                                                                                                                   | no        |
| `qr_generated`                                                           | **Once per user action:** one table's code generated or regenerated (QR dialog), or one bulk run (onboarding's tables, the print sheet's "Generate missing"), counting only the `POST /tables/:id/qr` calls that answered 2xx; nothing if none did | client (server-confirmed)        | `count` (codes generated in that action, 1–1000)                                                                                                                                       | **yes**   |
| `trial_started`                                                          | A person's first organization and its trial subscription committed                                                                                                                                                                                 | server (MP)                      | `plan_key`, `trial_days`                                                                                                                                                               | **yes**   |
| `upgrade_clicked`                                                        | The upgrade dialog opens (trial banner, subscription page, plan card)                                                                                                                                                                              | client                           | `plan_key` (pre-selected plan, optional)                                                                                                                                               | no        |
| `checkout_started`                                                       | `POST /organizations/:id/checkout` answered 2xx (Razorpay order created)                                                                                                                                                                           | client (server-confirmed)        | `plan_key`, `billing_cycle`, `value` (list price, rupees), `currency`                                                                                                                  | no        |
| `payment_succeeded`                                                      | The verify call or webhook that **activated** the order committed                                                                                                                                                                                  | server (MP)                      | `plan_key`, `billing_cycle`, `value`, `currency`, `renewal` (a paid period was still running: the previous subscription was ACTIVE **and** its `current_period_end` was in the future) | **yes**   |
| `subscription_activated`                                                 | Same moment as `payment_succeeded`, **only when not a renewal** (from trial, expiry, cancellation, or an ACTIVE plan whose paid period had already run out)                                                                                        | server (MP)                      | `plan_key`, `billing_cycle`                                                                                                                                                            | **yes**   |
| `qr_menu_viewed`, `order_submitted`, `order_accepted`, `order_completed` | see above                                                                                                                                                                                                                                          | database                         | not sent                                                                                                                                                                               | n/a       |
| `subscription_cancelled`; manual (Super Admin) activations               | Super Admin actions: no consented browser of the customer                                                                                                                                                                                          | database (`subscription_events`) | not sent                                                                                                                                                                               | n/a       |

Server events carry `session_id` (with `engagement_time_msec: 1`, which GA4 needs to place an event in a session) when the request's GA session cookie is readable; a webhook-confirmed payment has the stored client id only. A renewal is `payment_succeeded` with `renewal: true` and no `subscription_activated`, so the activation key event counts first activations only.

## Deduplication

- **Page views.** gtag's own page view is off (`send_page_view: false`) and enhanced measurement must be off on the stream, because GA4 still sends history-change page views with `send_page_view: false` when it is on ([manual page views][ga-views]). Our tracker sends one `page_view` per pathname change and ignores a repeat for the same pathname (React Strict Mode effects, re-renders, query-string changes, a remount, consent re-given on the same page). Unit tests and the E2E assert one view per navigation.
- **Server-confirmed client events** fire once per accepted response. A failed or rejected request emits nothing. **Bulk actions count once:** onboarding creates one QR code per table (4 requests in flight) and the print sheet generates every missing code. Both run inside `asOneAction("qr_generated", …)` (`api-events.ts`), which counts the accepted requests and sends a single `qr_generated` with `count` when the action ends, so ten tables are one key event, not ten.
- **`trackOnce` / `useTrackOnMount`** cap UI events at one per page load or per dialog opening.
- **Payments.** `payment_succeeded` and `subscription_activated` are emitted only from the transaction that called `activateInTx`: the verify path when it activated, the webhook path only for the `activated` outcome. `duplicate`, `already_paid`, `mismatch`, `unknown_order`, refreshed success pages, client retries and webhook replays emit nothing; the order row lock (`SELECT … FOR UPDATE`) guarantees only one path activates. Emission happens after `tx.run` resolves, so a rolled-back transaction emits nothing. No `transaction_id` is sent (it would be a tenant-linked id); dedupe is guaranteed on our side.
- **Trial.** One trial per person is enforced before the transaction, so `trial_started` fires once.
- **No anonymous duplicates.** Every server event carries the person's own GA client id, so GA4 never counts a server event as a new user.
- **Failures never break the operation.** `track` returns immediately; the GA4 adapter validates, posts with a 2-second `AbortSignal.timeout`, and logs `server_tracking_send_failed` with the event name and status or `timeout`/`network` only (never the URL, which holds the API secret, nor the payload). Services call `trackSafely`, so even a throwing adapter is logged, not raised. On hosts that throttle CPU after the response (Cloud Run request-based billing), a send may be delayed or dropped; that is acceptable because GA4 is not the system of record.

## Marketing acquisition vs product analytics

One stream per environment keeps the visitor → sign-up → workspace journey in one place (two streams would split the same person into two GA users at the moment they sign up). The split is `content_group`, a built-in GA4 dimension:

- **Marketing (acquisition):** Reports → Acquisition → Traffic acquisition, filtered to `content_group = marketing`; landing pages via `landing_page_view` or the built-in Landing page dimension. Campaign tags (`utm_*`) survive sanitization.
- **Product (adoption):** Explore → Funnel exploration on `signup_completed` → `trial_started` → `restaurant_created` → `menu_item_created` → `qr_generated` → `checkout_started` → `payment_succeeded`, filtered to `content_group = product` where relevant.
- **Auth:** sign-in, sign-up and invitation pages, so sign-up form drop-off is visible on its own.

## Growth funnel measurement framework

GA4 only sees visitors who opted in, and it samples and thresholds small numbers. It is right for acquisition source and on-site drop-off; it is wrong for counting customers or money. Each stage below says where its number comes from.

| Stage                       | Definition                                                                                      | Number from                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor                     | Session on the public site                                                                      | GA4 (consented visitors only; a lower bound)                                                                                                                |
| Sign-up started             | First focus in the sign-up form                                                                 | GA4                                                                                                                                                         |
| Signed up                   | Account created (excluding invited teammates)                                                   | **DB** `users` minus invitation accepts; GA4 `signup_completed` with `invited = false` for source attribution                                               |
| Workspace (trial started)   | Person's first organization created, trial running                                              | **DB** `subscription_events.type = 'trial_started'`                                                                                                         |
| Restaurant                  | First restaurant in the workspace                                                               | **DB** `restaurants`                                                                                                                                        |
| Menu item                   | First menu item                                                                                 | **DB** `menu_items`                                                                                                                                         |
| QR generated                | First table QR code                                                                             | **DB** `table_qr_tokens`                                                                                                                                    |
| First QR order (activation) | First order placed by a guest through a QR code                                                 | **DB** `orders.source = 'CUSTOMER'` (never GA4)                                                                                                             |
| Trial → paid                | First paid or activated subscription after the trial                                            | **DB** `subscription_events.type in ('paid','activated')`                                                                                                   |
| Revenue                     | Money received online                                                                           | **DB** `payment_orders.status = 'PAID'` (`amount_minor`, `paid_at`); manual activations have no amount in the database and need the offline invoice records |
| Adoption                    | Share of active workspaces using waiter acceptance, kitchen display, billing                    | **DB** `order_status_history` (`ACCEPTED`, `PREPARING`/`READY`), `bills`                                                                                    |
| Retention                   | Workspaces with QR orders in week _n_ after their first QR order; paid logo retention per month | **DB** `orders`, `subscriptions`                                                                                                                            |
| Drop-off                    | Stage-to-stage conversion and median time between stages per weekly cohort                      | **DB** for product stages; GA4 funnel exploration for pre-sign-up steps                                                                                     |

**Cohort funnel (run read-only against the production database, as a reporting role; aggregates only, never export rows with names or emails):**

```sql
-- Weekly trial cohorts: how far each workspace got, and how fast.
with trial as (
  select workspace_id, min(created_at) as at
  from subscription_events where type = 'trial_started' group by workspace_id
), firsts as (
  select t.workspace_id, t.at as trial_at,
    (select min(created_at) from restaurants r where r.workspace_id = t.workspace_id)      as restaurant_at,
    (select min(created_at) from menu_items m where m.workspace_id = t.workspace_id)       as menu_item_at,
    (select min(created_at) from table_qr_tokens q where q.workspace_id = t.workspace_id)  as qr_at,
    (select min(created_at) from orders o
       where o.workspace_id = t.workspace_id and o.source = 'CUSTOMER')                    as first_qr_order_at,
    (select min(created_at) from subscription_events e
       where e.workspace_id = t.workspace_id and e.type in ('paid', 'activated'))          as paid_at
  from trial t
)
select date_trunc('week', trial_at)                                   as cohort_week,
       count(*)                                                       as trials,
       count(restaurant_at)                                           as with_restaurant,
       count(menu_item_at)                                            as with_menu_item,
       count(qr_at)                                                   as with_qr,
       count(first_qr_order_at)                                       as activated_first_qr_order,
       count(paid_at)                                                 as paid,
       round(100.0 * count(paid_at) / count(*), 1)                    as trial_to_paid_pct,
       percentile_cont(0.5) within group (order by first_qr_order_at - trial_at) as median_time_to_first_order
from firsts
group by 1 order by 1;

-- Online revenue by month (INR minor units → rupees).
select date_trunc('month', paid_at) as month, currency, sum(amount_minor) / 100.0 as revenue, count(*) as payments
from payment_orders where status = 'PAID' group by 1, 2 order by 1;

-- Week-n retention after the first QR order.
with first_order as (
  select workspace_id, min(created_at) as at from orders where source = 'CUSTOMER' group by workspace_id
)
select date_trunc('week', f.at) as cohort_week,
       count(distinct f.workspace_id) as workspaces,
       count(distinct o.workspace_id) filter (where o.created_at >= f.at + interval '7 days'
                                                and o.created_at <  f.at + interval '14 days') as active_week_1,
       count(distinct o.workspace_id) filter (where o.created_at >= f.at + interval '28 days'
                                                and o.created_at <  f.at + interval '35 days') as active_week_4
from first_order f left join orders o on o.workspace_id = f.workspace_id
group by 1 order by 1;
```

Reconcile GA4 against the database monthly: `payment_succeeded` in GA4 should never exceed `payment_orders` paid in the same month. It is normally lower: only buyers who opted in are reported, and Cloud Run may drop a background send. The GA4 count is never used for revenue.

## Limits and quotas (standard property, verified 2026-11-10)

| Limit                                                        | Value                                                                                | Source                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| Event name / parameter name length                           | 40 characters                                                                        | [collection limits][ga-limits]           |
| Parameters per event                                         | 25                                                                                   | [collection limits][ga-limits]           |
| Parameter value length                                       | 100 characters (`page_title` 300, `page_referrer` 420, `page_location` 1,000)        | [collection limits][ga-limits]           |
| Distinct event names, web stream                             | no limit                                                                             | [collection limits][ga-limits]           |
| Event-scoped custom dimensions / custom metrics / key events | 50 / 50 / 30                                                                         | [configuration limits][ga-config-limits] |
| Event data retention                                         | 2 or 14 months                                                                       | [data retention][ga-retention]           |
| Measurement Protocol request                                 | ≤ 25 events, < 130 kB, backdated ≤ 72 hours; answers 2xx even for malformed payloads | [MP reference][mp-ref]                   |
| Measurement Protocol reserved prefixes                       | `_`, `firebase_`, `ga_`, `google_`, `gtag.` (parameter names)                        | [MP reference][mp-ref]                   |
| API secret                                                   | keep private, never in client code                                                   | [MP sending events][mp-send]             |

The catalog is tested against these limits (`tracking-events.test.ts`). We send one event per request, so the 25-event batch limit is never reached.

## Content-Security-Policy

`security-headers.ts` currently sets no fetch directives (no `default-src`, `script-src`, `connect-src` or `img-src`), so gtag.js needs no change. The policy is built at build time while the Measurement ID is read at runtime, so if fetch directives are ever added they must include the hosts in `GOOGLE_ANALYTICS_CSP` (`packages/web-core/src/tracking/gtag.ts`), which follow Google's list for Analytics without Ads features ([CSP guide][csp]): `script-src https://www.googletagmanager.com`; `img-src https://www.googletagmanager.com https://*.google-analytics.com`; `connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com`. That is the guide's list as checked on 2026-11-10; a narrower `https://*.analytics.google.com` was considered and not adopted, because the guide lists all of `*.google.com` and a narrower list could silently drop hits. `tracking/csp.test.ts` runs a small CSP evaluator against the shipped policy (must not block GA), against stricter policies it must catch (`default-src 'self'`, `script-src 'self'`), against a strict policy that lists Google's hosts (must pass), and flags a nonce + `'strict-dynamic'` `script-src`, where host lists are ignored and the nonce would have to be passed to the `<Script>` element. To list the hosts only when a Measurement ID is configured, the CSP would have to move into the per-request proxy.

## Manual GA4 setup

Do this twice, once for **staging** and once for **production**. Needs a Google account with Editor access; everything is free.

### 0. Release gate: Enhanced measurement off

A hard gate, not a recommendation. For each environment, **before** `GA_MEASUREMENT_ID` is set on its console:

1. **Admin → Data collection and modification → Data streams → Console → Enhanced measurement**: the switch is **off** (steps 1.3 below). Take a screenshot for the release record.
2. On **staging** only, after setting the ID with `GA_DEBUG_MODE=true`: in **Admin → Data display → DebugView**, navigate between three pages (including `/invite/x`, `/reset-password?token=x` and one `/app/w/<id>` page) and confirm exactly one `page_view` per navigation, no `scroll`, `click`, `view_search_results`, `form_start` or `file_download` events, and no token, UUID or non-`utm` query parameter in any `page_location`.
3. Production's ID stays unset until staging has passed 1 and 2, and production's own stream has passed 1.

If the switch is ever found on later, unset `GA_MEASUREMENT_ID` on the console first (a restart is enough), then fix the stream.

### 1. Property and web stream

1. analytics.google.com → **Admin** → **Create** → **Property**. Name `RestaurantOS – Production` (or `– Staging`), reporting time zone **India**, currency **Indian Rupee**. Finish the business details and accept the terms and the Data Processing Amendment ([create a property][ga-create]).
2. **Admin → Data collection and modification → Data streams → Add stream → Web**. URL: the console origin of that environment; name `Console`.
3. **Turn enhanced measurement off** before saving (or open the stream afterwards and switch **Enhanced measurement** off). This is the [release gate](#0-release-gate-enhanced-measurement-off): with it on, GA4 sends extra page views on every client navigation with raw URLs that can contain invitation tokens and workspace ids, plus site-search, outbound-click and file-download events we do not sanitize ([enhanced measurement][ga-em]).
4. Copy the **Measurement ID** (`G-…`) from **Stream details**.

### 2. Privacy settings

1. **Admin → Data collection and modification → Data collection:** leave **Google signals** off.
2. **Admin → Data collection and modification → Data retention:** event data retention **14 months** ([data retention][ga-retention]). The privacy policy says "up to 14 months"; choose 2 months only if the policy is changed to match.
3. Do not link Google Ads or other products.
4. Optional: **Data streams → Console → Configure tag settings → Define internal traffic** with your office IP, then activate the **Internal traffic** data filter under **Admin → Data filters**.

### 3. Measurement Protocol secret

1. **Admin → Data streams → Console → Measurement Protocol API secrets → Create**. Nickname `api-server`.
2. Store the value in Secret Manager as `GA_API_SECRET` for that environment's API service only. Never paste it into a frontend variable, a ticket or chat.

### 4. Environment variables

What each service ends up with:

| Service | Staging                                                                              | Production                                                                              |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| console | `GA_MEASUREMENT_ID=<staging G-…>`, `GA_DEBUG_MODE=true`                              | `GA_MEASUREMENT_ID=<production G-…>`                                                    |
| api     | `TRACKING_PROVIDER=ga4`, `GA_MEASUREMENT_ID=<staging G-…>`, `GA_API_SECRET` (secret) | `TRACKING_PROVIDER=ga4`, `GA_MEASUREMENT_ID=<production G-…>`, `GA_API_SECRET` (secret) |

**Do not set these by hand on Cloud Run.** `infra/gcp/deploy.sh` replaces each service's whole environment on every deploy, so a hand-set variable disappears at the next push. On staging the deploy script sets them from operator variables, and analytics stays **off** unless those are exported ([env reference](../environment-variables.md#staging-deploy-infragcpdeploysh)).

**Staging, step by step** (after steps 0–3: stream created, Enhanced measurement off, Measurement Protocol secret created in GA):

1. **Store the Measurement Protocol secret in Secret Manager. Owner approval needed:** this creates a new Secret Manager secret version, about ₹5/month of trial credit for one active version plus negligible access charges. Verify on the [Secret Manager pricing page](https://cloud.google.com/secret-manager/pricing). Paste the value at the prompt, so it never lands in shell history:

   ```bash
   read -rs GA_SECRET && printf '%s' "$GA_SECRET" | gcloud secrets create ros-staging-ga-api-secret \
     --project=restaurant-os-514008 --replication-policy=automatic --data-file=- ; unset GA_SECRET
   ```

   Expected: `gcloud secrets versions list ros-staging-ga-api-secret --project=restaurant-os-514008` shows version 1, enabled. For a later rotation, run `gcloud secrets versions add …` with the same pipe, then disable the old version.

2. **Let the API read it, and let the CI deployer see it exists** (`deploy.sh` checks with `gcloud secrets versions list`):

   ```bash
   gcloud secrets add-iam-policy-binding ros-staging-ga-api-secret --project=restaurant-os-514008 \
     --member="serviceAccount:ros-api@restaurant-os-514008.iam.gserviceaccount.com" \
     --role=roles/secretmanager.secretAccessor
   gcloud secrets add-iam-policy-binding ros-staging-ga-api-secret --project=restaurant-os-514008 \
     --member="serviceAccount:ros-deployer@restaurant-os-514008.iam.gserviceaccount.com" \
     --role=roles/secretmanager.viewer
   ```

   (`infra/gcp/setup-ci-identity.sh` also grants the deployer binding when re-run.) Without the accessor binding, the API deploy fails with "permission denied on secret".

3. **Export the ID and confirm the gate, then redeploy:**

   ```bash
   export STAGING_GA_MEASUREMENT_ID=G-XXXXXXX      # the staging stream (step 1.4)
   export STAGING_GA_ENHANCED_MEASUREMENT=off       # you checked step 0.1 on this stream
   TAG=$(git rev-parse --short HEAD) infra/gcp/deploy.sh
   ```

   Expected output: `GA4 server events on (G-…)` (API) and `console analytics on (G-…, debug true)`. With the ID but no secret, the console is on and server events stay off (`TRACKING_PROVIDER=none`). A malformed ID, or a missing `STAGING_GA_ENHANCED_MEASUREMENT=off`, stops the deploy before anything is touched.

4. **Make CI deploys keep it on:** add GitHub repository variables (Settings → Secrets and variables → Actions → Variables; none is a secret) named `STAGING_GA_MEASUREMENT_ID` and `STAGING_GA_ENHANCED_MEASUREMENT=off`, and optionally `STAGING_GA_DEBUG_MODE`. Without them, the next push to `staging` deploys with analytics off.

5. **Schedule the cleanup run** ([step 4b](#4b-schedule-the-cleanup-run-hourly)), then run the [verification](#7-verify-staging).

To turn analytics off again, unset the variables (shell and repository) and redeploy: the console loses the ID and the API gets `TRACKING_PROVIDER=none`.

**Production** has no deploy script yet (this GCP project hosts staging only). Its deploy definition must set the same variables from the production property and its own secret, after the release gate passes on staging.

### 4b. Schedule the cleanup run hourly

**Owner action (a cloud change, not in the repo).** Nothing in `infra/` schedules `POST /api/v1/jobs/subscriptions` today; the only Cloud Scheduler job is `ros-sql-guard` (staging). The privacy policy promises that an unused GA client id is deleted "by the next cleanup run" after 48 hours, so the job must run hourly in every environment with `TRACKING_PROVIDER=ga4`. The code already guarantees that an id older than 48 hours is never used.

```sh
# Once per environment. Call the API service URL directly: the frontends' proxy drops Authorization.
API_URL=https://<api service URL>
gcloud scheduler jobs create http ros-subscription-sweep \
  --project=<project> --location=asia-south1 \
  --schedule="23 * * * *" --time-zone=Asia/Kolkata \
  --uri="$API_URL/api/v1/jobs/subscriptions" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=ros-cron-secret --project=<project>)" \
  --attempt-deadline=120s
```

- The bearer secret is stored in the job's configuration, where anyone with Cloud Scheduler read access on the project can see it. After rotating `ros-cron-secret`, update the job with `gcloud scheduler jobs update http ros-subscription-sweep --update-headers=…`.
- **Cost:** Cloud Scheduler includes 3 free jobs per billing account. With `ros-sql-guard` the only one today, one more (or one per environment, if staging and production share a billing account) stays at ₹0. **Verify on the [Cloud Scheduler pricing page](https://cloud.google.com/scheduler/pricing) before creating it.**
- **Staging:** while `ros-sql-guard` keeps Cloud SQL stopped, runs fail (HTTP 500) and the next run after a start catches up. An over-age id is still never used.
- **Check:** each run logs `subscription_sweep_completed` with `analyticsIdsCleared`; a failure of the cleanup itself logs `analytics_id_cleanup_failed`.

### 5. Key events

**Admin → Data display → Key events → New key event**, one per name: `signup_completed`, `trial_started`, `qr_generated`, `payment_succeeded`, `subscription_activated`. Marking ahead of collection is supported ([mark key events][ga-key-events]). For `payment_succeeded`, the event's own `value` and `currency` are used.

### 6. Custom dimensions

**Admin → Data display → Custom definitions → Create custom dimension**, scope **Event**, one per parameter: `plan_key`, `billing_cycle`, `renewal`, `invited`, `landing_page`. Then **Create custom metric**, scope **Event**, unit Standard: `count` (QR codes per `qr_generated`), and `trial_days` if you want sums. `content_group` is built in and needs nothing.

### 7. Verify (staging)

1. Open the staging console in a private window: the banner shows, DevTools → Network shows **no** request to `googletagmanager.com` or `google-analytics.com`.
2. Press **Decline**, browse: still none. Use **Cookie settings** in the footer, press **Allow analytics**: one request for `gtag/js`, then collect hits.
3. **Admin → Data display → DebugView** ([DebugView][ga-debugview]): the [release gate](#0-release-gate-enhanced-measurement-off) checks.
4. Sign up a test owner: `signup_started`, `signup_completed`, `workspace_created`, then `trial_started` (server, appears in Realtime; Measurement Protocol events do not carry `debug_mode`). Repeat in a private window after pressing **Decline**: no `trial_started` for that owner.
5. With Razorpay **test** keys, buy a plan: one `checkout_started`, then one `payment_succeeded` (`renewal: false`) and one `subscription_activated`. Refresh the success page and replay the webhook from the Razorpay dashboard: the counts do not change. Renew the same plan: one `payment_succeeded` with `renewal: true`, no new `subscription_activated`.
6. Open two tabs, press **Decline** from **Cookie settings** in one: the other stops (DevTools → Console: `window['ga-disable-G-…']` is `true`) and no new collect hits appear from either.
7. Optional payload check without collecting data: `POST https://www.google-analytics.com/debug/mp/collect?measurement_id=…&api_secret=…` with a body copied from `ga4-measurement-protocol.test.ts` returns validation messages.
8. Then set `GA_DEBUG_MODE` off and repeat steps 1–2 against production with the production ID.

### 8. Legal

The privacy policy describes the optional analytics exactly as built (see privacy rule 9) and lists Google as a recipient. **It must be reviewed by a lawyer with the rest of the legal templates before launch**, in particular: the cross-border transfer wording, the retention period, the residual case of a payment reported after a withdrawal, and whether Google should be named as Google LLC or another Google entity under the terms you accept in step 1.1.

## Tests

| What                                                                                                                                                                                                                                                                                                                                                                              | Where                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog completeness, GA4 limits, PII rejected (types and runtime), plan keys at the platform's edges, renewal shape, stored and consent-gated GA ids                                                                                                                                                                                                                             | `packages/contracts/src/tracking-events.test.ts`                                                                                                                                                                                                    |
| Token and id stripping, `utm` filtering, referrers, content groups, public and product route-word lists in step with the app                                                                                                                                                                                                                                                      | `packages/web-core/src/tracking/sanitize.test.ts`                                                                                                                                                                                                   |
| No ID → nothing rendered; consent gating; decline/withdraw; withdrawal and opt-in from another tab (BroadcastChannel, visibilitychange, cookie re-check); Consent Mode order; one page_view per route change; titles never sent; tag switched off on a client navigation into `/t/*` or `/print/*` and back on afterwards                                                         | `packages/web-core/src/tracking/tracking-client.test.tsx`, `track.test.ts`, `tracking.test.tsx`                                                                                                                                                     |
| "Cookie settings" in the auth footer and the account menu (absent without an ID); reopening moves focus to the banner, the first appearance does not                                                                                                                                                                                                                              | `packages/web-core/src/tracking/privacy-choices.test.tsx`                                                                                                                                                                                           |
| API-confirmed events and their routes; `qr_generated` once per action (single = 1, bulk = one event with `count`, nested runs join, none accepted = nothing); CSP evaluator (shipped policy passes, strict policies caught, `'strict-dynamic'` flagged); onboarding: 10 tables → one `qr_generated{count:10}` (`apps/console/src/features/onboarding/onboarding-wizard.test.tsx`) | `packages/web-core/src/tracking/api-events.test.ts`, `csp.test.ts`                                                                                                                                                                                  |
| API observer                                                                                                                                                                                                                                                                                                                                                                      | `packages/api-client/src/index.test.ts`                                                                                                                                                                                                             |
| MP payload shape, no event without consented ids, session + engagement time, PII refusal, timeout, failures logged without the secret                                                                                                                                                                                                                                             | `packages/adapters/src/tracking/providers/ga4-measurement-protocol.test.ts`                                                                                                                                                                         |
| Env validation (malformed ID ignored with `none`, refused with `ga4`)                                                                                                                                                                                                                                                                                                             | `packages/application/src/config/env-tracking.test.ts`                                                                                                                                                                                              |
| Server events through real routes: only with consent; verify, webhook with the stored opt-in, replay/duplicate, withdrawn at verify, renewal and lapsed-then-repaid, mismatch, trial, Super Admin never, stored id cleared on payment, over-age id ignored and cleared by verify and webhook, cleanup run (also when the subscription sweep fails), throwing adapter              | `apps/api/tests/integration/server-tracking.test.ts`                                                                                                                                                                                                |
| Browser: no request to Google without an ID or without consent; one page_view per client navigation; guest pages; withdrawal across tabs; auth-page Cookie settings                                                                                                                                                                                                               | `tests/e2e/analytics-consent.spec.ts`. CI runs the consent half after the main suite on the same builds: `GA_MEASUREMENT_ID=G-E2ETEST01 E2E_SKIP_BUILD=1 pnpm test:e2e tests/e2e/analytics-consent.spec.ts` (every Google request answered locally) |

[consent-about]: https://support.google.com/analytics/answer/9976101
[consent-dev]: https://developers.google.com/tag-platform/security/guides/consent
[ga-views]: https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag
[ga-em]: https://support.google.com/analytics/answer/9216061
[ga-limits]: https://support.google.com/analytics/answer/9267744
[ga-config-limits]: https://support.google.com/analytics/answer/12229528
[ga-retention]: https://support.google.com/analytics/answer/7667196
[ga-ip]: https://support.google.com/analytics/answer/12017362
[ga-create]: https://support.google.com/analytics/answer/9304153
[ga-key-events]: https://support.google.com/analytics/answer/13128484
[ga-debugview]: https://support.google.com/analytics/answer/7201382
[mp-ref]: https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference
[mp-send]: https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events
[csp]: https://developers.google.com/tag-platform/security/guides/csp
