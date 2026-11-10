# Growth measurement with Google Analytics 4

How RestaurantOS measures acquisition and product adoption with Google Analytics 4 (GA4), what it never sends, and which numbers must come from the database instead. GA4 and the Measurement Protocol are free for a standard property; nothing here needs a paid plan.

**Status:** built and tested, **inert until configured**. No GA4 property exists yet. With no Measurement ID the console renders no banner, loads no script and makes no request to Google, and the API sends nothing (`TRACKING_PROVIDER=none`). The [setup steps](#manual-ga4-setup) at the end turn it on.

## Decisions at a glance

| Question                      | Decision                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent model                 | Opt-in. gtag.js is not loaded, and `window.dataLayer` does not exist, until the visitor presses **Allow analytics**. This is Google's _basic_ consent mode ("Google tags blocked until consent is granted", [About consent mode][consent-about]).               |
| Consent Mode v2               | Every type (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`) defaults to `denied` as the first command; only `analytics_storage` is ever updated to `granted`. Advertising stays denied for good, `ads_data_redaction` is on.           |
| Which apps                    | The console only (public site, sign-up, owner dashboard). Ops (kitchen screens and shared counter devices) and admin (internal) do not mount it. Each frontend reads `GA_MEASUREMENT_ID` from its own runtime environment, so enabling another app is one line. |
| Guest QR pages (`/t/<token>`) | Never measured in GA4: no banner, no tag, no cookie. Diner and kitchen events (`qr_menu_viewed`, `order_submitted`, `order_accepted`, `order_completed`) are database-derived (see [why](#why-diner-and-kitchen-events-are-not-in-ga4)).                        |
| Page views                    | Manual: `send_page_view: false`, one `page_view` per route change from our code, enhanced measurement **off** on the stream. This is the only way to strip tokens and tenant ids from every URL GA4 sees.                                                       |
| Marketing vs product          | One web stream per environment; GA4's built-in `content_group` is `marketing`, `auth` or `product` on every page view and event, so acquisition and product use are separated without breaking the visitor → sign-up journey across two streams.                |
| Server-authoritative events   | `trial_started`, `payment_succeeded`, `subscription_activated`, `subscription_cancelled` are sent by the API through the Measurement Protocol after the database transaction commits, once per transition.                                                      |
| Attribution of server events  | The API reads the browser's GA client id from the `_ga` cookie that the console's `/api/v1` proxy forwards, **only** if the consent cookie says `granted`. Otherwise the event is anonymous (fresh random client id, no session).                               |
| Revenue and funnel truth      | Revenue, trials, paid conversions, activation and retention come from the database. GA4 is for acquisition source, page-level drop-off and on-site behaviour of visitors who opted in.                                                                          |

## Architecture

```
 Browser (console)                                  API                                   Google
 ─────────────────                                  ───                                   ──────
 root layout ─ <Tracking/> (server, reads GA_MEASUREMENT_ID at request time)
   └─ TrackingClient (client)
        ├─ ConsentBanner ── Allow ──▶ cookie ros_analytics_consent=granted
        ├─ configureGtag()  consent default denied → update analytics granted → config
        ├─ <Script gtag.js>  ───────────────────────────────────────────────────────────▶ googletagmanager.com
        ├─ trackPageView()   one page_view per pathname, sanitized URL ─────────────────▶ *.google-analytics.com
        ├─ startApiTracking()  api-client onApiSuccess → server-confirmed events
        └─ track()/trackOnce()/useTrackOnMount()  UI events (sign-up focus, upgrade dialog)

 fetch /api/v1/* ── console proxy (forwards Cookie) ──▶ route() → RequestMeta.analytics
                                                       (client id + session id, only with consent cookie)
                                                    services emit after commit ─▶ ServerTracking port
                                                       ├─ none   (default)
                                                       ├─ memory (tests)
                                                       └─ ga4    Measurement Protocol, 2 s timeout ───────▶ www.google-analytics.com/mp/collect
```

| Piece                                                                                  | File                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Event catalog (names, strict zod params, source, key event), PII guard, consent cookie | `packages/contracts/src/tracking-events.ts`                                                                                                                                                                  |
| Browser tracker                                                                        | `packages/web-core/src/tracking/` (`tracking.tsx`, `tracking-client.tsx`, `consent.ts`, `consent-banner.tsx`, `gtag.ts`, `track.ts`, `page-views.ts`, `api-events.ts`, `sanitize.ts`, `privacy-choices.tsx`) |
| Server port                                                                            | `packages/application/src/ports/server-tracking.ts`                                                                                                                                                          |
| Adapters                                                                               | `packages/adapters/src/tracking/providers/ga4-measurement-protocol.ts`, `memory.ts` (`none` is `noServerTracking` in the port)                                                                               |
| Composition                                                                            | `apps/api/src/composition/container.ts` (`selectTracking`), `payments.ts`, `workspaces.ts`, `platform.ts`                                                                                                    |
| Request attribution                                                                    | `packages/application/src/http/route.ts` (`RequestMeta.analytics`)                                                                                                                                           |

The owner-facing product dashboard in `packages/web-core/src/features/analytics` is unrelated: it shows a restaurant its own sales from the database and sends nothing to Google.

### Why API-confirmed client events

`signup_completed`, `login_completed`, `workspace_created`, `restaurant_created`, `branch_created`, `menu_item_created`, `qr_generated` and `checkout_started` fire from one observer on the shared API client (`onApiSuccess` in `packages/api-client`) when the API answered 2xx to the matching `POST` (table in `api-events.ts`). They therefore count what the server accepted, from every screen that can do it (dialogs, the onboarding wizard, later screens), with no per-screen code to forget. A unit test checks every template against a real `route.ts` exporting `POST` under `apps/api/src/app/api/v1`, so a renamed API route fails CI instead of silently losing an event. The observer reads the response body only for the checkout's plan key, cycle and list price.

## Configuration per environment

Every value is read at runtime; nothing is baked into an image. Frontends never get a `NEXT_PUBLIC_` variable.

| Variable            | Service              | Default | Purpose                                                                                                                                  |
| ------------------- | -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GA_MEASUREMENT_ID` | console              | unset   | This environment's GA4 web stream (`G-…`). Unset or malformed: tracking is inert.                                                        |
| `GA_DEBUG_MODE`     | console              | unset   | `true` adds `debug_mode` to the config so events appear in GA4 DebugView. Staging only.                                                  |
| `TRACKING_PROVIDER` | api                  | `none`  | `none` sends nothing; `ga4` sends server events through the Measurement Protocol.                                                        |
| `GA_MEASUREMENT_ID` | api                  | unset   | Must equal the console's value in the same environment so server events join the browser's data. Also needed to read the session cookie. |
| `GA_API_SECRET`     | api (Secret Manager) | unset   | Measurement Protocol API secret of that stream. With `ga4`, startup fails unless both are set. Never logged, never sent to a browser.    |

| Environment        | console `GA_MEASUREMENT_ID` | api `TRACKING_PROVIDER` / `GA_MEASUREMENT_ID` / `GA_API_SECRET` |
| ------------------ | --------------------------- | --------------------------------------------------------------- |
| Local dev, CI, E2E | unset                       | `none` / unset / unset                                          |
| Staging            | staging stream `G-…`        | `ga4` / staging stream / staging secret                         |
| Production         | production stream `G-…`     | `ga4` / production stream / production secret                   |

**Staging never pollutes production:** use two separate GA4 properties, not two streams in one property. The production ID and secret exist only in the production services' environment and Secret Manager entries; staging services are configured with the staging property. Tests use the memory adapter and a fake `G-E2ETEST01` id with every request to Google stubbed.

## Privacy rules (India DPDP Act)

1. **Notice and choice before any processing.** The banner explains what is collected and links to the privacy policy (cookies section updated). **Decline** and **Allow analytics** are the same size, style and weight; ignoring the banner means no analytics. Nothing about the visitor goes to Google before Allow.
2. **Withdrawal as easy as consent.** "Cookie settings" in the site footer reopens the banner showing the current choice. Declining sets `window['ga-disable-<ID>'] = true`, updates `analytics_storage` to `denied`, and deletes `_ga` / `_ga_<container>` on this host and every parent domain. Stale GA cookies are also deleted whenever the stored choice is not `granted`.
3. **Choice is remembered** in the first-party cookie `ros_analytics_consent` (`granted` | `denied`, 180 days, `SameSite=Lax`, `Secure` on HTTPS). After 180 days the visitor is asked again. GA cookies use the same 180-day lifetime and are host-scoped (`cookie_domain: "none"`), so ops and admin subdomains never receive them.
4. **No personal data, no tenant data.** The catalog's parameters are enums, booleans, bounded numbers and plan-key slugs. TypeScript rejects an unknown key such as `email`; at runtime `validateTrackingEvent` drops events with unknown keys or with string values that look like an email, phone number, UUID, JWT or token. No `user_id`, `user_data`, IP override, restaurant name, workspace id or payment id is ever sent.
5. **URLs are sanitized** before GA4 sees them (`sanitize.ts`): `/t/<token>` → `/t/:token`, `/invite/<token>` → `/invite/:token`; under `/app` only known route words survive and everything else becomes `:id`; elsewhere UUIDs and numbers become `:id` and token-like segments `:redacted`; the query string keeps only `utm_*` tags (themselves screened); fragments are dropped. App page titles (which can name a restaurant) are replaced by the sanitized path; external referrers are reduced to their origin.
6. **No advertising.** Google signals and ad personalization signals are off in the tag; Measurement Protocol requests send `consent.ad_user_data` and `consent.ad_personalization` as `DENIED`. GA4 does not log or store IP addresses ([GA4 IP handling][ga-ip]).
7. **Diners are never tracked by GA4** (no banner on `/t/*`, the tag never loads there even for a device that opted in elsewhere).
8. **Server attribution respects the choice.** The API uses the `_ga` client id only when the consent cookie is `granted` and `GA_MEASUREMENT_ID` is configured. Super Admin actions are always anonymous, never attributed to the admin's own browser.

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

| Event                                                                    | Trigger                                                                                      | Source                    | Parameters                                                                     | Key event |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ | --------- |
| `page_view`                                                              | Every pathname change on a measured route, once                                              | client                    | `page_location`, `page_referrer`, `page_title` (sanitized), `content_group`    | no        |
| `landing_page_view`                                                      | First page view of a tab session (after opt-in) when it is a public-site page                | client                    | `landing_page` (sanitized path)                                                | no        |
| `signup_started`                                                         | First focus inside the sign-up form, once per page load                                      | client                    | `invited` (sign-up came from an invitation link)                               | no        |
| `signup_completed`                                                       | `POST /auth/signup` answered 2xx                                                             | client (server-confirmed) | `method: "password"`, `invited`                                                | **yes**   |
| `login_completed`                                                        | `POST /auth/signin` answered 2xx                                                             | client (server-confirmed) | `method: "password"`                                                           | no        |
| `workspace_created`                                                      | `POST /workspaces` answered 2xx                                                              | client (server-confirmed) | none                                                                           | no        |
| `restaurant_created`                                                     | `POST /workspaces/:id/restaurants` answered 2xx                                              | client (server-confirmed) | none                                                                           | no        |
| `branch_created`                                                         | `POST /restaurants/:id/branches` answered 2xx                                                | client (server-confirmed) | none                                                                           | no        |
| `menu_item_created`                                                      | `POST /restaurants/:id/menu/items` answered 2xx                                              | client (server-confirmed) | none                                                                           | no        |
| `qr_generated`                                                           | `POST /tables/:id/qr` answered 2xx (generate or regenerate one table's code)                 | client (server-confirmed) | none                                                                           | **yes**   |
| `trial_started`                                                          | A person's first organization and its trial subscription committed                           | server (MP)               | `plan_key`, `trial_days`                                                       | **yes**   |
| `upgrade_clicked`                                                        | The upgrade dialog opens (trial banner, subscription page, plan card)                        | client                    | `plan_key` (pre-selected plan, optional)                                       | no        |
| `checkout_started`                                                       | `POST /organizations/:id/checkout` answered 2xx (Razorpay order created)                     | client (server-confirmed) | `plan_key`, `billing_cycle`, `value` (list price, rupees), `currency`          | no        |
| `payment_succeeded`                                                      | The verify call or webhook that **activated** the order committed                            | server (MP)               | `plan_key`, `billing_cycle`, `value`, `currency`                               | **yes**   |
| `subscription_activated`                                                 | Same moment as `payment_succeeded`, or a Super Admin activation / upgrade approval committed | server (MP)               | `plan_key`, `billing_cycle`, `activation_source` (`online_payment` / `manual`) | **yes**   |
| `subscription_cancelled`                                                 | Super Admin cancellation committed                                                           | server (MP)               | `plan_key`, `previous_status` (`active` / `trialing`)                          | no        |
| `qr_menu_viewed`, `order_submitted`, `order_accepted`, `order_completed` | see above                                                                                    | database                  | not sent                                                                       | n/a       |

Server events carry `session_id` too when the visitor's GA session cookie is readable, so they land in the visitor's current session.

## Deduplication

- **Page views.** gtag's own page view is off (`send_page_view: false`) and enhanced measurement must be off on the stream, because GA4 still sends history-change page views with `send_page_view: false` when it is on ([manual page views][ga-views]). Our tracker sends one `page_view` per pathname change and ignores a repeat for the same pathname (React Strict Mode effects, re-renders, query-string changes, a remount, consent re-given on the same page). Unit tests and the E2E assert one view per navigation.
- **Server-confirmed client events** fire once per accepted response. A failed or rejected request emits nothing.
- **`trackOnce` / `useTrackOnMount`** cap UI events at one per page load or per dialog opening.
- **Payments.** `payment_succeeded` and `subscription_activated` are emitted only from the transaction that called `activateInTx`: the verify path when it activated, the webhook path only for the `activated` outcome. `duplicate`, `already_paid`, `mismatch`, `unknown_order`, refreshed success pages, client retries and webhook replays emit nothing; the order row lock (`SELECT … FOR UPDATE`) guarantees only one path activates. Emission happens after `tx.run` resolves, so a rolled-back transaction emits nothing. No `transaction_id` is sent (it would be a tenant-linked id); dedupe is guaranteed on our side.
- **Trial.** One trial per person is enforced before the transaction, so `trial_started` fires once.
- **Cancellation.** Cancelling an already cancelled subscription is refused (409), so it fires once.
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

Reconcile GA4 against the database monthly: `payment_succeeded` in GA4 should never exceed `payment_orders` paid in the same month (it can be lower: Cloud Run may drop a background send, and the GA4 count is not used for revenue).

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

`security-headers.ts` currently sets no fetch directives (no `default-src`, `script-src`, `connect-src` or `img-src`), so gtag.js needs no change. The policy is built at build time while the Measurement ID is read at runtime, so if fetch directives are ever added they must include the hosts in `GOOGLE_ANALYTICS_CSP` (`packages/web-core/src/tracking/gtag.ts`), which follow Google's list for Analytics without Ads features ([CSP guide][csp]): `script-src https://www.googletagmanager.com`; `img-src https://www.googletagmanager.com https://*.google-analytics.com`; `connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com`. `tracking/csp.test.ts` fails if a future policy blocks them. To list them only when a Measurement ID is configured, the CSP would have to move into the per-request proxy.

## Manual GA4 setup

Do this twice, once for **staging** and once for **production**. Needs a Google account with Editor access; everything is free.

### 1. Property and web stream

1. analytics.google.com → **Admin** → **Create** → **Property**. Name `RestaurantOS – Production` (or `– Staging`), reporting time zone **India**, currency **Indian Rupee**. Finish the business details and accept the terms and the Data Processing Amendment ([create a property][ga-create]).
2. **Admin → Data collection and modification → Data streams → Add stream → Web**. URL: the console origin of that environment; name `Console`.
3. **Turn enhanced measurement off** before saving (or open the stream afterwards and switch **Enhanced measurement** off). This is required: with it on, GA4 sends extra page views on every client navigation with raw URLs that can contain invitation tokens and workspace ids, plus site-search, outbound-click and file-download events we do not sanitize ([enhanced measurement][ga-em]).
4. Copy the **Measurement ID** (`G-…`) from **Stream details**.

### 2. Privacy settings

1. **Admin → Data collection and modification → Data collection:** leave **Google signals** off.
2. **Admin → Data collection and modification → Data retention:** event data retention **14 months** (or 2 if you prefer less) ([data retention][ga-retention]).
3. Do not link Google Ads or other products.
4. Optional: **Data streams → Console → Configure tag settings → Define internal traffic** with your office IP, then activate the **Internal traffic** data filter under **Admin → Data filters**.

### 3. Measurement Protocol secret

1. **Admin → Data streams → Console → Measurement Protocol API secrets → Create**. Nickname `api-server`.
2. Store the value in Secret Manager as `GA_API_SECRET` for that environment's API service only. Never paste it into a frontend variable, a ticket or chat.

### 4. Environment variables

| Service | Staging                                                                              | Production                                                                              |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| console | `GA_MEASUREMENT_ID=<staging G-…>`, `GA_DEBUG_MODE=true`                              | `GA_MEASUREMENT_ID=<production G-…>`                                                    |
| api     | `TRACKING_PROVIDER=ga4`, `GA_MEASUREMENT_ID=<staging G-…>`, `GA_API_SECRET` (secret) | `TRACKING_PROVIDER=ga4`, `GA_MEASUREMENT_ID=<production G-…>`, `GA_API_SECRET` (secret) |

Redeploy (a restart is enough; nothing is built in). The banner appears on the public site once the console has the ID.

### 5. Key events

**Admin → Data display → Key events → New key event**, one per name: `signup_completed`, `trial_started`, `qr_generated`, `payment_succeeded`, `subscription_activated`. Marking ahead of collection is supported ([mark key events][ga-key-events]). For `payment_succeeded`, the event's own `value` and `currency` are used.

### 6. Custom dimensions

**Admin → Data display → Custom definitions → Create custom dimension**, scope **Event**, one per parameter: `plan_key`, `billing_cycle`, `activation_source`, `previous_status`, `invited`, `landing_page`, `trial_days` (as a custom metric if you want sums). `content_group` is built in and needs nothing.

### 7. Verify (staging)

1. Open the staging console in a private window: the banner shows, DevTools → Network shows **no** request to `googletagmanager.com` or `google-analytics.com`.
2. Press **Decline**, browse: still none. Use **Cookie settings** in the footer, press **Allow analytics**: one request for `gtag/js`, then collect hits.
3. **Admin → Data display → DebugView** ([DebugView][ga-debugview]): navigate between three pages; exactly one `page_view` per navigation, `page_location` without tokens, ids or non-`utm` query parameters. Open `/invite/x` or `/reset-password?token=x` and confirm `page_location` shows `:token` or no query.
4. Sign up a test owner: `signup_started`, `signup_completed`, `workspace_created`, then `trial_started` (server, appears in Realtime; Measurement Protocol events do not carry `debug_mode`).
5. With Razorpay **test** keys, buy a plan: one `checkout_started`, then one `payment_succeeded` and one `subscription_activated`. Refresh the success page and replay the webhook from the Razorpay dashboard: the counts do not change.
6. Optional payload check without collecting data: `POST https://www.google-analytics.com/debug/mp/collect?measurement_id=…&api_secret=…` with a body copied from `ga4-measurement-protocol.test.ts` returns validation messages.
7. Then set `GA_DEBUG_MODE` off and repeat steps 1–2 against production with the production ID.

### 8. Legal

The privacy policy's cookies section now describes the optional analytics. Have it reviewed with the rest of the legal templates before launch, and name Google as a processor in the "Who we share data with" section.

## Tests

| What                                                                                                                    | Where                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog completeness, GA4 limits, PII rejected (types and runtime), consent-gated GA ids                                | `packages/contracts/src/tracking-events.test.ts`                                                                                        |
| Token and id stripping, `utm` filtering, referrers, content groups, route-word list in step with the app                | `packages/web-core/src/tracking/sanitize.test.ts`                                                                                       |
| No ID → nothing rendered; consent gating; decline/withdraw; Consent Mode order; one page_view per route change          | `packages/web-core/src/tracking/tracking-client.test.tsx`, `track.test.ts`, `tracking.test.tsx`                                         |
| API-confirmed events and their routes; CSP does not block GA                                                            | `packages/web-core/src/tracking/api-events.test.ts`, `csp.test.ts`                                                                      |
| API observer                                                                                                            | `packages/api-client/src/index.test.ts`                                                                                                 |
| MP payload shape, anonymous ids, PII refusal, timeout, failures logged without the secret                               | `packages/adapters/src/tracking/providers/ga4-measurement-protocol.test.ts`                                                             |
| Env validation                                                                                                          | `packages/application/src/config/env-tracking.test.ts`                                                                                  |
| Once-only server events through real routes: verify, webhook replay/duplicate, mismatch, trial, admin, throwing adapter | `apps/api/tests/integration/server-tracking.test.ts`                                                                                    |
| Browser: no request to Google without an ID or without consent; one page_view per client navigation; guest pages        | `tests/e2e/analytics-consent.spec.ts` (consent half: `GA_MEASUREMENT_ID=G-E2ETEST01 pnpm test:e2e tests/e2e/analytics-consent.spec.ts`) |

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
