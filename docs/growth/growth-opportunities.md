# Growth opportunities (first-time owner's view)

Audit of the path an Indian restaurant owner takes from sign-up to the first
accepted order, and what would bring more owners in, get them to that first
order sooner, keep them using the product and turn them into paying customers.

Rules for this list: everything costs ₹0 to build and run (no paid APIs, SaaS or
licensed dependencies), no dark patterns (no fake urgency, no intrusive pop-ups,
no extra mandatory steps), and nothing that weakens privacy or tenant isolation.

Impact and effort are estimates: **S** = under a day, **M** = 1-3 days,
**L** = a week or more. Impact is relative to the funnel stage it affects.

## The first-value journey today

Measured on a local build (see the W3 audit report for the script and numbers):
sign up → name the business → restaurant and first branch → first dish →
tables → dashboard → print QR codes → test order on a real table's guest page →
accept it in the waiter console → it appears on the kitchen display.

What a new owner ran into before this audit:

1. After onboarding they landed on a dashboard of zeros with no next step.
2. The workspace "Finish setting up" card was driven by wizard flags, not data:
   it showed "First restaurant" as not done right after creating one, listed
   "QR codes" and "Invite staff" with no way to complete them from the card, and
   "Continue setup" led back into a finished wizard. Finishing the wizard with
   its main button hid the card for good.
3. There was no obvious way to try ordering as a guest before printing codes.
4. Help and support lived only in the sidebar of the workspace area.
5. On phones the trial banner was a four-line column beside its buttons, the
   waiter screen scrolled sideways, and the menu editor was 881 px wide.
6. Back links in the waiter, kitchen and cashier screens and notification links
   pointed at the wrong app (404) after the platform split.

## Implemented in this audit

| #   | Stage        | Change                                                                                                                                                                                                                                              | Commit               | Expected impact                                                      | Effort |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------- | ------ |
| 1   | Activation   | "Get ready for your first order" checklist on the branch and workspace overviews, driven by the branch's real menu, tables, QR codes and orders; each step links to the page that completes it; hides itself when done; one click hides it for good | `bdd2e97`            | High: it is the only guidance between onboarding and the first order | M      |
| 2   | Activation   | Onboarding hands over to that checklist (no longer dismisses it) and offers "Print QR codes" directly                                                                                                                                               | `a818b3d`            | Medium                                                               | S      |
| 3   | Activation   | Owner can place a test order: "Open guest menu" in the checklist and in every table's QR dialog                                                                                                                                                     | `bdd2e97`, `c4508ca` | High: removes the "does this actually work?" doubt before printing   | S      |
| 4   | Retention    | "Help & support" in the account menu on every console and ops screen                                                                                                                                                                                | `c4508ca`            | Medium: support is one tap away at the moment of confusion           | S      |
| 5   | Monetization | Trial banner readable on phones; in the last week it says what to do and that data is kept (no countdown theatrics)                                                                                                                                 | `c4508ca`            | Medium: clear, honest expiry messaging                               | S      |
| 6   | Retention    | Sidebar always names the workspace (never the branch); account menu agrees                                                                                                                                                                          | `761dfbc`            | Low-medium: fewer "where am I?" moments                              | S      |
| 7   | Retention    | Staff and owner screens usable at 360 px; zero axe violations on 26 audited screens                                                                                                                                                                 | `cc31d32`, `a95d28d` | Medium: most owners and waiters use budget Android phones            | M      |
| 8   | Retention    | Notification links open the right app                                                                                                                                                                                                               | `aa7adef`            | Low-medium                                                           | S      |

Already in the base before this audit (not W3 work, listed so they are not
re-proposed): plan limits shown in the console with upgrade prompts at the
limit, plain-words explainer of workspace/restaurant/branch, inline validation
in onboarding.

## Recommendations (not implemented)

Ordered by expected impact per unit of effort within each stage.

### Activation (sign-up → first accepted order)

| #   | Opportunity                                                                                                                                                       | Why                                                                                        | Impact     | Effort |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- | ------ |
| A1  | **Starter menus**: pick "South Indian tiffin", "North Indian", "Café" or "Biryani house" in the menu step and get 10-15 editable dishes with prices               | Typing a menu is the longest step; a filled menu makes the guest preview feel real at once | High       | M      |
| A2  | **CSV menu import** (name, category, price, veg/non-veg) with a downloadable template                                                                             | Owners already keep menus in Excel/Google Sheets                                           | High       | M      |
| A3  | **Mark and clear test orders**: a "test" flag on orders placed from the owner's own session, excluded from analytics, with "clear test data"                      | Owners hesitate to place a test order that pollutes today's numbers                        | Medium     | M      |
| A4  | **Day-1 and day-3 nudge emails** listing the checklist steps still open, sent through the existing email port (free SMTP tier such as Gmail or Brevo's free plan) | Brings back owners who left mid-setup                                                      | Medium     | S      |
| A5  | Add **"Invite your team"** as a sixth checklist step once the first order is accepted, with a WhatsApp share of the invite link (`wa.me` links are free)          | Waiters must be on the app before the first real service                                   | Medium     | S      |
| A6  | Ask for **business type and number of tables** during sign-up only as optional defaults (prefill table count, starter menu)                                       | Better defaults with no extra mandatory step                                               | Low-medium | S      |

### Acquisition

| #   | Opportunity                                                                                                                                                           | Why                                                                       | Impact      | Effort   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- | -------- |
| Q1  | **"Share menu on WhatsApp"** button for the branch's public menu link                                                                                                 | WhatsApp is the default channel for Indian restaurants and their regulars | High        | S        |
| Q2  | Small, tasteful **"Menu by RestaurantOS"** link on the guest menu and printed QR card (removable on paid plans) pointing to sign-up with a `ref` code                 | Every table becomes a free, honest referral surface                       | Medium-high | S        |
| Q3  | **Referral credit**: one free month for both sides when a referred restaurant accepts its first order (applied with the existing extend-trial/activate admin actions) | ₹0 cash cost (revenue forgone only); owners talk to owners                | Medium      | M        |
| Q4  | **Google Business Profile guide**: how to add the menu link and QR to the listing                                                                                     | Free, high-intent discovery                                               | Medium      | S (docs) |
| Q5  | Guest menu in **Hindi and regional languages** (owner picks; dish names stay as entered)                                                                              | Wider guest reach, especially outside metros                              | Medium      | L        |

### Retention

| #   | Opportunity                                                                                                     | Why                                                        | Impact     | Effort |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | ------ |
| R1  | **Daily summary email** at closing time: orders, collections by method, top dishes, delays                      | Gives owners a reason to open the product every day        | High       | M      |
| R2  | **Weekly menu insight**: best sellers, items never ordered, slowest to prepare (data already exists in Reports) | Turns reports into actions                                 | Medium     | S      |
| R3  | **Guest feedback** (1-tap rating after the bill) shown to the owner                                             | Owners value reviews; it also shows the product is working | Medium     | M      |
| R4  | **In-app "What's new"** using the existing announcement bar, not pop-ups                                        | Feature discovery without interruptions                    | Low-medium | S      |
| R5  | **Offline confidence**: a short "what works offline" note in the waiter and kitchen consoles' help              | Wi-Fi drops are common; trust drives daily use             | Low-medium | S      |

### Monetization

| #   | Opportunity                                                                                                                                      | Why                                                    | Impact      | Effort             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------- | ------------------ |
| M1  | **Plan comparison inside the subscription page** with GST-inclusive INR prices and what each plan unlocks, linked from the trial banner          | Owners decide faster when the price is clear and local | High        | S                  |
| M2  | **Annual plan** with an honest discount (e.g. 2 months free)                                                                                     | Improves cash flow and retention                       | Medium-high | S (pricing + copy) |
| M3  | **Upgrade at the moment of value**: after the 30th order or the first busy evening, a quiet card (not a pop-up) showing what the trial delivered | Ties the price to proven value                         | Medium      | M                  |
| M4  | **UPI-first checkout copy** once Razorpay live mode is approved (owner action; test mode stays enforced in code)                                 | UPI is the default way Indian SMBs pay                 | Medium      | S                  |
| M5  | **Grace-period clarity**: a single page explaining exactly what keeps working after the trial ends and how to export data                        | Reduces fear of lock-in, which blocks paid conversion  | Medium      | S                  |

## How to measure

Coordinate with the analytics workstream (docs/growth/analytics-events.md):

- Activation: share of new workspaces with an accepted order within 24 hours and
  7 days; median time from sign-up to first accepted order; checklist step
  completion and hide rates.
- Acquisition: sign-ups per referral code and per WhatsApp share.
- Retention: weekly active branches (any order accepted in the week), daily
  summary email open rate.
- Monetization: trial-to-paid conversion, upgrade requests per plan-limit
  notice shown.

Never include guest personal data or order contents in analytics events.
