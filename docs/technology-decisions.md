# Technology & Infrastructure Decisions

**Status:** PROPOSED (Phase 1). Waiting for owner approval. Nothing here is implemented yet.
**Free-tier facts checked:** 2026-11-04 against provider docs and pricing pages (sources at the end).
Re-check every limit before going live. Providers change their terms often.

---

## 1. Summary

| Capability | Choice (MVP) | Free tier (verified) | Card needed? | Swap via |
|---|---|---|---|---|
| Language | TypeScript (strict) everywhere | n/a | n/a | n/a |
| Monorepo | pnpm workspaces + Turborepo | n/a | n/a | n/a |
| Web app (all dashboards + customer menu) | React + Vite SPA, installable PWA | n/a | n/a | n/a |
| Web hosting | Cloudflare Pages (`*.pages.dev`) | Unlimited bandwidth and static requests, 500 builds/month, commercial use allowed | No | Any static host |
| API | Node 22 + Hono (runtime-agnostic) + zod/OpenAPI | n/a | n/a | n/a |
| API hosting | Render free web service (`*.onrender.com`) | 750 instance-hours/month, sleeps after 15 min idle (kept awake by a ping) | No | Any Node host or container (no host-specific code) |
| Database | **MongoDB Atlas free cluster** (native `mongodb` driver) | 512 MB storage, 100 ops/sec, 3-node replica set | No | Repository ports (`packages/core/ports`) |
| Auth (identity only) | Better Auth library, users stored in our own MongoDB | No vendor quota (self-hosted library) | No | `AuthProvider` port |
| Authorization / RBAC | Our own code + Mongo collections | n/a | n/a | n/a (app-owned) |
| Realtime (staff devices) | Ably | 6M messages/month, 200 concurrent connections, 200 channels, 500 msg/sec | No | `RealtimePublisher` / `RealtimeClient` ports |
| Push notifications | Standard Web Push (VAPID keys) | No vendor; browser push services | No | `PushSender` port |
| Email | Brevo (MVP, no domain needed) → Resend once a domain exists | Brevo: 300/day. Resend: 3,000/month, 100/day, needs a verified domain | No | `EmailSender` port |
| File/image storage | Cloudflare R2 (S3 API) | 10 GB, free egress | **Yes** (to activate) | `ObjectStorage` port; Backblaze B2 / MinIO use the same S3 adapter |
| Scheduled jobs + keep-alive | Cloudflare Workers Cron → signed API endpoints | Workers free: 100k requests/day | No | Any cron caller (GitHub Actions, etc.) |
| Backups | GitHub Actions nightly `mongodump` → private bucket | Actions free minutes | No | n/a |
| Error monitoring | Sentry Developer | 5,000 errors/month, 1 user | No | `ErrorReporter` port |
| Product analytics | Not in MVP (YAGNI) | n/a | n/a | added later behind a port |

**Month-one cost: ₹0**, as long as you can add a card for R2 (or use the no-card storage fallback in §9).

---

## 2. Database: can we use MongoDB? **Yes, it works.**

### 2.1 Mapping each hard requirement to MongoDB

| Requirement | How MongoDB covers it |
|---|---|
| Transaction-safe billing and payments | Multi-document ACID transactions need a replica set. The Atlas free cluster is a fixed 3-node replica set, so transactions work on the free tier. |
| Idempotent order creation (offline replay) | Unique index on `{ workspaceId, idempotencyKey }`. A replayed operation hits the duplicate-key error, and we return the original result. |
| One active session per table, concurrent scans | Partial unique index on `table_sessions { tableId }` where `status: "open"`. Concurrent "open session" calls collapse to one; the losers read the winner's session. |
| A bill can't be paid twice | Conditional update `{ _id, status: "issued", version }` → `paid`, plus the payment insert, in one transaction. Partial unique index on `payments { billId }` where `status: "confirmed"`. |
| Prices snapshotted on orders | Order lines embed a copy of name, variant, modifiers, unit price and tax. Embedding is natural in a document model. |
| Database constraints | `$jsonSchema` collection validators (shape, enums, required fields) plus zod validation at the API boundary. |
| Migrations | `migrate-mongo`-style versioned scripts for indexes, validators and data backfills, run in CI and at deploy. |
| Reporting dashboards | Aggregation pipelines over indexed, tenant-scoped collections. Fine at MVP scale. |

### 2.2 What we give up compared with PostgreSQL (honest trade-offs)

1. **No row-level security.** Postgres can enforce tenant isolation in the database itself. With MongoDB, isolation lives only in our code. Mitigation (non-negotiable):
   - All tenant data goes through a `TenantScopedRepository` that *requires* a server-resolved `TenantContext` and injects `workspaceId` (and `restaurantId`/`branchId` where relevant) into every filter and write.
   - Every tenant collection has compound indexes that start with `workspaceId`.
   - A lint rule bans raw collection access outside `apps/api/src/infrastructure/mongo`.
   - A cross-tenant attack test suite runs in CI (spec scenarios 1, 8 and 9).
2. **No foreign keys.** References are checked in the application service and inside the transaction where it matters (order → table session → table).
3. **Ad-hoc SQL reporting is harder.** If you later need accounting exports or heavy analytics, a reporting replica (or a move to Postgres) is a contained change, because business logic only sees repository ports.

**When Postgres would be the better choice:** heavy cross-entity reporting, accounting integrations, or if you want database-enforced RLS as a second wall. None of these is in the MVP. The port/adapter design keeps a later switch to "write a new adapter set + migrate data", not a rewrite.

### 2.3 Atlas free-tier limits that matter for us

- **512 MB storage**, with no auto-expanding storage.
- **100 operations/second.** Above that, Atlas throttles (queues operations).
- **10 GB in / 10 GB out** per rolling 7 days.
- One free cluster per project. No downloadable logs.
- **Pauses after 30 days with zero connections** (current docs). A live restaurant never hits this; the keep-alive job also connects daily.
- **Backups:** don't rely on them on the free tier. We run our own nightly `mongodump` (§12).

**Capacity estimate (needs measuring once built):** an order with snapshotted lines is about 2–4 KB including index overhead. With 10 busy pilot restaurants at ~150 orders/day, that's ~45k orders and ~100–150 MB per month. **So 512 MB lasts roughly 3–4 months at that load.** Plan: upgrade to Atlas Flex when we pass ~60% storage. Cold orders older than the retention window can also be archived to object storage.

Other free Postgres options have the same ceiling (Neon free: 0.5 GB per project; Supabase free: 500 MB, and projects pause after 7 days without activity). So storage is not a reason to pick Postgres over MongoDB.

### 2.4 Access library choice
Native `mongodb` driver, **not Mongoose**. Domain entities stay plain TypeScript. Mapping to and from documents lives only in the Mongo adapters (`toDomain` / `toDocument`), so no Mongoose document objects leak into business logic.

---

## 3. API runtime and hosting

**Framework:** Hono. The same app runs on Node, Cloudflare Workers, Bun or Deno, which keeps hosting replaceable without code changes. Contracts are zod schemas exported as OpenAPI (`@hono/zod-openapi`).

**MVP host: Render free web service** (Singapore region, closest to India).
- 750 free instance-hours per workspace per month. That's enough for one service running 24/7.
- Sleeps after 15 minutes with no inbound traffic and takes about a minute to wake. **Mitigation:** a Cloudflare Cron Worker pings `/health` every 10 minutes. The PWA also queues writes locally, so a cold start doesn't lose actions.
- Ephemeral filesystem (we never write to local disk), and Render may restart free services at any time. Clients reconnect and resync.
- Upgrade: Render Starter, about $7/month, with no sleeping.

**Alternative evaluated (and kept open): Cloudflare Workers free.**
- 100,000 requests/day and 10 ms CPU per request. It never sleeps.
- Cloudflare now officially documents the native MongoDB driver on Workers, and recommends a Durable Object to hold the connection between requests.
- **Why not primary yet:** the 10 ms CPU limit is risky for password hashing and MongoDB SCRAM authentication, and this setup is newer and less proven.
- **Plan:** a short spike in Phase 2. If it passes, Workers becomes a zero-sleep free host for the same Hono app.

**Rejected:**
- **Vercel Hobby:** its terms limit Hobby to non-commercial personal use, so a paid SaaS can't run on it.
- **Koyeb free:** since February 2026 it needs a card with a $29 hold, it sleeps after 1 hour idle, and you get one service.
- **Supabase:** free projects pause after 7 days of inactivity.

## 4. Web hosting
**Cloudflare Pages.** Unlimited bandwidth, unlimited sites, 500 builds/month, and commercial use is allowed on the free plan. The app is static files (SPA + service worker), so any static host works. Free subdomain: `<project>.pages.dev`.

## 5. Frontend stack
- React 19 + Vite, TanStack Router (type-safe routes, code-split per role area), TanStack Query (server state).
- PWA: `vite-plugin-pwa` (Workbox) for install, the app shell and asset caching.
- Local persistence: **Dexie (IndexedDB)** behind a `LocalStore` interface; the sync engine sits on top of it (see the architecture doc).
- Design system: Tailwind CSS + shadcn/ui (Radix primitives, accessible by default) in a `packages/ui` package.
- Forms: react-hook-form + zod resolvers using the **same zod schemas the API uses** (no duplicated validation). Field-level errors are highlighted.
- i18n scaffold (English first; Hindi strings can be added later without refactoring).

One web app with role-based areas: `/c/:qrToken` customer, `/w` waiter, `/k` kitchen, `/o` owner/manager, `/admin` super admin. The customer route is a separate lightweight bundle so a QR scan loads fast on cheap phones.

## 6. Authentication
**Better Auth** (open-source library) with its MongoDB adapter.
- User accounts live in *our* database, so there's no external identity vendor to migrate away from.
- MVP sign-in methods: email + password, Google OAuth, and invite links.
- Used for **identity and sessions only.** Workspaces, memberships, roles and permissions are our own collections and code. (We are not using Better Auth's "organization" plugin, because our model is Workspace → Restaurant → Branch with per-restaurant roles.)
- Guest customers have no account. Scanning a QR gets a short-lived signed **table-session token** scoped to one table session.
- Platform Super Admin: the `platform_admins` collection, seeded by a CLI command. It is never derived from anything the client sends.
- Behind an `AuthProvider` port, so Firebase/Clerk/Auth0 could replace it. Only the identity mapping (`externalUserId → userId`) changes.

## 7. Realtime
**Ably** for staff devices (waiter, kitchen, manager).
- Free tier: 6M messages/month, 200 concurrent connections, 200 concurrent channels, 500 messages/sec.
- Our API issues **Ably tokens with per-branch channel capabilities** after its own authorization check, so tenant authorization never depends on Ably.
- The API publishes domain events after the database commit, e.g. `order.created`, `order.accepted`.
- **Customers don't hold Ably connections.** They poll order status every ~10 s (cheap, and it saves the 200-connection budget).
- If a realtime message is missed, clients refetch on reconnect. **The database is the source of truth; realtime is only a "go refetch" signal.**
- Upgrade: Ably Standard, $29/month base. Alternative adapters: Pusher, or our own SSE once the API is always-on.

## 8. Notifications
- **In-app:** `notifications` collection + activity log, shown in the UI.
- **Push:** standard **Web Push with VAPID keys** (`web-push` library). No vendor account or quota. iPhones receive push only when the PWA is installed to the home screen (iOS 16.4+).
- **Email:** the MVP has no paid domain. Resend can only email *your own* address until you verify a domain you own. So:
  - **MVP: Brevo free** (300 emails/day). It verifies a single sender address instead of a domain. Deliverability from a Gmail sender address is mediocre, so email is **non-critical** in the MVP: staff invites also work as copyable/WhatsApp links, and trial reminders also appear in-app and as push.
  - **Later:** buy a domain (a few hundred rupees a year), verify it with Resend (3,000/month free) or Brevo, and swap the adapter through config.

## 9. File / image storage
**Cloudflare R2** through the S3 API (`@aws-sdk/client-s3`, presigned PUT/GET).
- 10 GB free and egress is free. **Activating R2 requires adding a card or PayPal**, even on the free tier.
- No card? **Backblaze B2** (10 GB free) or **MinIO** locally use the *same* S3 adapter; only the endpoint and keys in env change.
- Images are resized and compressed in the browser before upload (~200 KB each). Uploads are validated server-side (type sniffing, size limits).
- The database stores **object keys only**. URLs are always produced by the storage adapter.

## 10. Monitoring and logging
- Sentry Developer (free): 5,000 errors/month, 1 user. Used on both API and web.
- Structured JSON logs (pino) with a request ID and tenant IDs, never secrets or PII.
- Upgrade: Sentry Team, ~$26/month.

## 11. Scheduled jobs
A Cloudflare Worker with Cron Triggers calls HMAC-signed `/internal/jobs/*` endpoints for trial-expiry reminders, retention sweeps, the keep-alive ping and backup verification.
**Subscription status is computed from dates at read time** (trial end, grace end). A missed or late job can never wrongly grant or block access; jobs only send reminders and do cleanup.

## 12. Backups and recovery
A nightly GitHub Actions workflow runs `mongodump --gzip` into a private bucket (separate credentials) and keeps 30 days.
A monthly restore drill runs against a scratch database. Details go in `docs/deployment.md` in Phase 11.

## 13. Cost as usage grows (estimates, USD/month)

| Stage | What changes | Est. cost |
|---|---|---|
| Build + first 1–5 pilot restaurants | All free tiers | **$0** |
| ~10–30 restaurants, real daily use | Render Starter (no sleep) ~$7, Atlas Flex $8–30 | **~$15–40** |
| ~50–150 restaurants | + Ably Standard $29, + Resend Pro $20 (or Brevo paid), + Sentry Team ~$26 | **~$80–130** |
| 150+ restaurants | Atlas dedicated M10 (~$57+), more API instances | **$150+** |

Upgrade points to watch: Atlas storage > 60%, Ably concurrent connections > 150, Render memory, Sentry quota, email daily cap.

## 14. Migration strategy (summary)
Every replaceable capability sits behind a port in `packages/core/src/ports`, and each adapter lives in `apps/api/src/infrastructure/<provider>`. One composition root (`apps/api/src/container.ts`) picks adapters from env config. Replacing a provider means:
1. Write a new adapter.
2. Run the shared port contract tests against it.
3. Change the env var.
4. For data-bearing providers (DB, storage), run a migration script.

`docs/provider-migration-guide.md` (written in Phase 2) will list exact files and steps per provider.

---

## Sources (checked 2026-11-04)
- MongoDB Atlas free cluster limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Atlas pricing (M0 512 MB / 100 ops/sec, Flex): https://www.mongodb.com/pricing
- Atlas auto-pause of idle free clusters: https://www.mongodb.com/docs/atlas/pause-terminate-cluster/
- Cloudflare Workers limits / pricing: https://developers.cloudflare.com/workers/platform/limits , https://developers.cloudflare.com/workers/platform/pricing/
- MongoDB on Cloudflare Workers (official tutorial): https://developers.cloudflare.com/workers/tutorials/connect-to-mongodb-atlas/
- Render free tier: https://render.com/docs/free
- Vercel Hobby fair use: https://vercel.com/docs/limits/fair-use-guidelines
- Koyeb scale-to-zero: https://www.koyeb.com/docs/run-and-scale/scale-to-zero (card/$29 hold: third-party report, https://snapdeploy.dev/koyeb-alternative)
- Supabase free plan: https://supabase.com/kb/faqs/platform/database-only-cost
- Neon free plan: https://neon.com/faqs/free-plan-limits-and-quotas
- Ably free package: https://ably.com/docs/pricing/free
- Better Auth MongoDB adapter: https://better-auth.com/docs/adapters/mongo
- Resend domain requirement: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- Brevo free SMTP: https://www.sendinblue.com/free-smtp-server/
- Sentry plans (third-party summary, verify at sentry.io/pricing): https://last9.io/blog/sentry-pricing/
- Cloudflare Pages free plan (third-party summary, verify at cloudflare.com/plans): https://freetier.co/directory/products/cloudflare-pages
