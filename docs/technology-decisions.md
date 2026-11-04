# Technology & Infrastructure Decisions

**Status:** DECIDED by the architect for the application stack (row 3 of §0). Production providers are **candidates only**: nothing is signed up for, activated or paid for (§13).
**Facts checked:** 2026-11-04. Sources and how they were checked are listed in §14.

> **How facts were checked.** This session's network policy blocked direct downloads of provider pages (neon.com, supabase.com, aiven.io and others returned a proxy refusal). So every fact below comes from web-search excerpts. **[O]** means the excerpt came from the provider's own page or docs. **[3P]** means it came only from a third-party summary. **Unverified** means no source settled the point. Re-check every limit on the provider's live page before signing up, because providers change their terms often.

---

## 0. Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                          | Effect on this document                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | **Owner decision: the frontend is one Next.js 16 App Router app** (TypeScript strict, Tailwind v4, shadcn/ui, Zustand, TanStack Query, React Hook Form + Zod, Dexie, Serwist PWA, Vitest, Playwright), with folders organized by feature (`src/features/*`) and provider interfaces under `src/infrastructure/*`. | Replaces the React + Vite SPA and the monorepo layout in `architecture.md` §2.                                                      |
| 2026-11-04 | **Owner decision: don't select or configure database, auth, hosting or paid infrastructure yet.**                                                                                                                                                                                                                 | Production providers stay candidates. No accounts, keys or paid plans exist (§13).                                                  |
| 2026-11-04 | **Architect decision: PostgreSQL + Drizzle, in-app auth, SSE realtime, adapter-based providers; supersedes the MongoDB/Better Auth/Ably proposal.**                                                                                                                                                               | §2–§11 rewritten. MongoDB Atlas, Better Auth, Ably and Cloudflare Pages are no longer the MVP choices. Ably stays a future adapter. |

---

## 1. Summary

| Capability         | Initial choice (in code)                                                              | Local dev / test adapter                                 | Production candidate                                                                    | Free-tier key limits (candidate)                                                                             | Card needed?                           | Swap via                                                         |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| Database           | PostgreSQL via Drizzle ORM (`pg` driver)                                              | Local PostgreSQL 16 (dev/CI). PGlite (integration tests) | **Neon Free** (fallback: Aiven Free, then Supabase Free)                                | Neon: 100 projects, 100 CU-hours/project/month, 1 GB/project (raised Oct 2026), 5 GB transfer, scale to zero | No [O]                                 | Repository interfaces (`src/infrastructure/database/interfaces`) |
| Auth (identity)    | In-app: scrypt (`node:crypto`), opaque session tokens stored hashed, httpOnly cookies | Same code, local Postgres                                | Same code, no vendor                                                                    | No vendor quota                                                                                              | No                                     | `IdentityProvider`                                               |
| Hosting            | `next build` + `next start` (plain Node server)                                       | `next dev`                                               | **Render free web service, Singapore** → Starter when live (fallback: Google Cloud Run) | 750 instance-hours/workspace/month, sleeps after 15 min idle, ~1 min wake                                    | No (Render). Yes (Cloud Run)           | Host-neutral build (no host-specific code)                       |
| Realtime           | In-app Server-Sent Events + in-process event bus + client polling fallback            | Same                                                     | Same, on one long-running instance                                                      | No vendor quota. Single-instance only (§5)                                                                   | No                                     | `RealtimePublisher`                                              |
| Email              | Console/DB log adapter                                                                | Console/DB log adapter                                   | **Resend** once a domain is bought. Brevo before that                                   | Resend: 3,000/month, 100/day, verified domain. Brevo: 300/day                                                | No (both, not confirmed for Resend)    | `EmailSender`                                                    |
| File/image storage | Local filesystem adapter                                                              | Local filesystem                                         | **Cloudflare R2** (no-card fallback: Backblaze B2)                                      | R2: 10 GB-month, 1M Class A + 10M Class B ops/month, free egress                                             | **Yes** for R2 [3P]. B2: reportedly no | `ObjectStorage`                                                  |
| Push               | Standard Web Push (VAPID, `web-push`)                                                 | Same (browser push services)                             | Same, no vendor                                                                         | No vendor quota. iOS needs Home Screen install (16.4+)                                                       | No                                     | `PushSender`                                                     |
| Errors / logs      | Structured JSON logs to stdout. `ErrorReporter` console adapter                       | Console                                                  | **Sentry Developer** for errors. Host log viewer for logs                               | Sentry: 5k errors/month, 1 user                                                                              | No [3P]                                | `ErrorReporter`                                                  |
| Uptime monitor     | n/a                                                                                   | n/a                                                      | Better Stack free                                                                       | 10 monitors, 3-min checks, 3 GB logs / 3 days                                                                | Unverified                             | n/a (external)                                                   |
| Scheduled jobs     | Secret-protected `POST /api/internal/jobs/*` route handlers                           | Manual `curl`                                            | **cron-job.org** (backup: GitHub Actions schedule)                                      | cron-job.org: free, every 1 min, 30 s timeout                                                                | No                                     | Any HTTP cron caller                                             |
| Backups            | Nightly `pg_dump` from GitHub Actions to object storage                               | n/a                                                      | GitHub Actions → R2/B2                                                                  | Actions free minutes (not re-checked)                                                                        | No                                     | n/a                                                              |

**Month-one cost: ₹0 / $0.** Every candidate above has a free tier that needs no card, except R2 (use B2 if no card).

---

## 2. Database: PostgreSQL + Drizzle (decided)

### 2.1 Why Postgres (architect decision)

- **Foreign keys and multi-statement transactions** for orders → table sessions → bills → payments.
- **Row-level security (RLS)** as a second wall behind the application's tenant scoping.
- **Partial unique indexes** for "one open session per table", "one confirmed payment per bill" and `(workspace_id, idempotency_key)`.
- **SQL reporting** for owner dashboards and accounting exports.
- **Drizzle** keeps the schema in TypeScript (`src/infrastructure/database/providers/postgres/schema/*`), generates migrations with `drizzle-kit`, and stays behind repository interfaces. Domain code never imports Drizzle.

### 2.2 Environments

| Environment       | Database                         | Notes                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev and CI  | PostgreSQL 16 (Docker or native) | Same major version as production. Pick a production host that offers 16 (or test on the host's version before go-live).                                                                                                                                                                                       |
| Integration tests | PGlite (`@electric-sql/pglite`)  | In-process Postgres in WASM, so tests are fast and isolated. **Risks:** it is single-connection, so it can't reproduce concurrent-transaction races; it runs as superuser, which **bypasses RLS** unless tests switch to a non-owner role. Keep a small CI suite on real Postgres 16 for concurrency and RLS. |
| Production        | Hosted Postgres (below)          | Use the provider's **pooled** connection string from the app and the direct one for migrations.                                                                                                                                                                                                               |

### 2.3 Free hosted Postgres comparison

| Provider                                | Free storage                                                                                | Compute / requests                                                             | Inactivity policy                                                                                                                                                                         | Card                                                                | Commercial use                                        | First paid tier                                                                                         | Verdict                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon Free**                           | **1 GB/project** (blog + pricing page, Oct 2026) [O]. Docs pages still say 0.5 GB           | 100 CU-hours/project/month, up to 2 CU. 5 GB public transfer/project/month [O] | Compute scales to zero after 5 min idle, then wakes on connect (cold start). Data kept [O]. One third-party guide says free projects pause after ~1 week without requests: **unverified** | No [O]                                                              | Reported allowed [3P]. Terms not read                 | Launch: usage-based. ~$0.106/CU-hour, ~$0.35/GB-month [3P]. $5 minimum reportedly removed Dec 2025 [3P] | **Recommended.** Real Postgres, Singapore region (`aws-ap-southeast-1`) [O], serverless driver, branching.                               |
| Supabase Free                           | 500 MB database [3P, consistent]                                                            | Shared micro compute. 5 GB egress (some say 10 GB) [3P]. 2 active projects     | **Pauses after 7 days of low activity** [O]. Restore window 90 days or 1 year (official pages disagree)                                                                                   | No [3P]                                                             | Reported allowed [3P]                                 | Pro $25/month per org incl. $10 compute credit, 8 GB DB [3P]                                            | Fallback. Brings auth/storage/realtime we don't need. Pausing is a risk in a slow week.                                                  |
| Aiven for PostgreSQL Free               | 1 GB [O]                                                                                    | 1 CPU, 1 GB RAM, single node, **max_connections 20**, no pooling [O]           | **Powered off after inactivity** (email warning). Can be powered on again [O]                                                                                                             | No [O]                                                              | "Personal or professional use" [O blog]. AUP not read | Developer tier from $5/month, not powered off [O]                                                       | Second fallback. 20 connections is tight but OK for one Node instance with a small pool.                                                 |
| Prisma Postgres Free                    | 2 GB, up to 50 databases [O]                                                                | **200,000 operations/month** (1 query = 1 op) [O]. Queries stop at the limit   | Scales to zero [O]. No automatic backups on Free [O]                                                                                                                                      | Unverified                                                          | Unverified                                            | Starter $10/month, 1M ops, then $8/M ops, 10 GB [O]                                                     | Rejected for prod. 10 pilot restaurants could exceed 200k queries/month.                                                                 |
| CockroachDB Basic (Postgres-compatible) | $15/month free credit ≈ 50M request units + 10 GiB [O]                                      | Request-unit metered                                                           | Unverified                                                                                                                                                                                | Unverified (credit applies to monthly card/marketplace billing) [O] | Unverified                                            | $0.20 per 1M RUs, $0.50/GiB beyond the credit [O]                                                       | Rejected. Not Postgres: SQL and locking differences. RLS only since v25.2 and bypassed by FK cascades [O]. Drizzle support not verified. |
| Xata                                    | **No free tier** on the new platform. Xata Lite was shut down (HTTP 410) [3P + CTO podcast] | n/a                                                                            | n/a                                                                                                                                                                                       | n/a                                                                 | n/a                                                   | Unverified                                                                                              | Rejected.                                                                                                                                |
| Render Postgres Free                    | 1 GB [O]                                                                                    | Shared                                                                         | **Expires 30 days after creation**. No backups [O]                                                                                                                                        | No                                                                  | n/a                                                   | Paid Postgres from ~$6/month [3P]                                                                       | Rejected for prod (expiry).                                                                                                              |
| Self-host on Oracle Always Free VM      | Up to 200 GB block storage [3P]                                                             | A1 Arm VM (§4)                                                                 | Idle-instance reclaim (§4)                                                                                                                                                                | Yes [O]                                                             | Yes                                                   | n/a                                                                                                     | Possible later. We would run backups, upgrades and security ourselves.                                                                   |

### 2.4 Recommendation and risks

**Production candidate: Neon Free in `aws-ap-southeast-1` (Singapore), same region as the app host.** Upgrade to Neon Launch when storage passes ~60% or the compute hours run low.

Risks and mitigations:

1. **Cold starts.** After 5 idle minutes the compute suspends, so the first query takes longer. During service hours a live restaurant keeps it warm. Overnight, the first request is slow. Acceptable for MVP. The PWA's offline queue hides it.
2. **Compute budget.** At the 0.25 CU minimum, 100 CU-hours run about 400 hours, which is less than a 744-hour month if the database never sleeps. **Don't ping the database to keep it awake**; let it scale to zero overnight. Watch the usage page weekly during the pilot.
3. **Storage.** 1 GB per project. An order with lines and indexes is roughly 2–4 KB (an estimate; measure once built). 10 pilot restaurants × 150 orders/day ≈ 45k orders/month ≈ 100–180 MB/month, so roughly 5–9 months of headroom.
4. **Conflicting docs.** Neon's docs pages and its blog/pricing page disagree (0.5 GB vs 1 GB; 50 vs 100 CU-hours). Treat the lower numbers as the safe planning figure until the live page is checked.
5. **Lock-in: low.** We use standard Postgres via `pg` + Drizzle. Moving is `pg_dump`/`pg_restore` plus a connection-string change. Don't use Neon-only features (Data API, Neon Auth) in app code.
6. **Backups.** Don't rely on free-tier restore. Run our own nightly `pg_dump` (§12).

---

## 3. Authentication: in-app (decided)

**Design.**

- Passwords are hashed with `crypto.scrypt` (Node built-in) using a per-user random salt. Parameters are stored with each hash so they can be raised later. Comparison uses `timingSafeEqual`.
- Sessions use an opaque 32-byte random token. The cookie (`httpOnly`, `Secure`, `SameSite=Lax`) holds the token. Postgres stores only its SHA-256 hash, with expiry, rotation and revocation.
- Workspaces, memberships, roles and permissions are our own tables. Guest customers get a short-lived signed table-session token.
- All of this sits behind `IdentityProvider`, so an external IdP could be added later. Only the `external_user_id → user_id` mapping changes.

**Alternatives considered:**

| Option             | What it is                           | Free tier                                                | Why not chosen                                                                                                                                                                       |
| ------------------ | ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Better Auth        | Open-source library, users in our DB | No vendor quota                                          | Good option, but adds a dependency and its own schema conventions. Our needs (email/password, invites) are small. Keep it as the first choice if we add many OAuth providers or MFA. |
| Auth.js (NextAuth) | Open-source library                  | No vendor quota                                          | Weaker email/password support and upgrade churn. Project stewardship has moved toward the Better Auth team (reported; not re-verified in this check).                                |
| Clerk              | Hosted vendor                        | 50,000 monthly retained users free; Pro $25/month [O/3P] | Users live in the vendor's DB. Per-user pricing and vendor lock-in.                                                                                                                  |
| Supabase Auth      | Hosted with Supabase                 | 50,000 MAU free [3P]                                     | Ties auth to Supabase, and free projects pause after 7 days.                                                                                                                         |

**Why in-app:** no vendor quotas or lock-in, users stay in our own Postgres, and it works on any Node host.

**Risks:**

- **We own security.** Need rate limiting on login and reset, a lockout/backoff policy, CSRF protection on cookie-authenticated mutations, secure reset tokens (hashed, single-use, short expiry), and session rotation on privilege change. Add a security test checklist before go-live.
- **CPU cost of scrypt.** Recommended scrypt settings take tens of milliseconds of CPU per hash (an estimate; benchmark on the chosen host). That's fine on a Node server. On Cloudflare Workers Free (10 ms CPU per request) it is a blocker (§4).

---

## 4. Hosting for a commercial Next.js app

Requirements: route handlers, SSR, Server Actions, **commercial use allowed**, a long-lived process for the SSE event bus, and `node:crypto` scrypt.

### 4.1 Comparison

| Host                          | Free tier                                                                                                                                                             | Commercial use on free?                                                                         | Sleep / pause                                                                                 | Card                                                                                         | First paid tier                                                                     | Fit for our design                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Hobby                  | Generous serverless limits                                                                                                                                            | **No.** "Hobby teams are restricted to non-commercial personal use only" [O]                    | No sleep                                                                                      | No                                                                                           | Pro (price not re-checked)                                                          | **Rejected:** commercial SaaS is not allowed. Function max duration for SSE: sources conflict (10 s vs 300 s).                                                                                                                                                                                                                                                                                                                                                             |
| Netlify Free                  | 300 credits/month [O changelog]. Third-party credit costs: bandwidth 20 credits/GB, deploy 15, compute 10/GB-hour [3P]                                                | Reported yes [3P]. Terms not read                                                               | **Sites reportedly paused when credits run out** [3P]                                         | No [3P]                                                                                      | Personal $9/month (1,000 credits) [3P]                                              | Next.js App Router and route handlers are fully supported via OpenNext-based adapter [O]. But **synchronous functions time out at 10 s** by default [O forum], so SSE streams get cut, and functions are stateless (no in-process bus). Polling-only.                                                                                                                                                                                                                      |
| Cloudflare Workers (OpenNext) | 100,000 requests/day, **10 ms CPU/request**, 128 MB memory [O]. Hyperdrive: 100,000 DB queries/day free [O]. Cron: 5 triggers/account [O]                             | Yes (no non-commercial clause found)                                                            | Never sleeps                                                                                  | No                                                                                           | Workers Paid $5/month: 10M requests, 30M CPU-ms, up to 5 min CPU [O]                | Next.js 16 supported by `@opennextjs/cloudflare`, but **Node.js middleware (`proxy.ts`) reportedly not yet** [3P]. Bundle limit: 3 MiB compressed on Free per OpenNext docs vs 64 MB uncompressed per an Oct 2026 report (conflict). **scrypt exceeds 10 ms CPU.** In-process event bus doesn't work across isolates (needs Durable Objects). Postgres via Hyperdrive or the Neon serverless driver (HTTP for single queries; WebSocket for interactive transactions) [O]. |
| **Render free web service**   | 750 instance-hours/workspace/month [O]. New Hobby plan: 25 services, reportedly 5 GB bandwidth (from 100 GB) since Aug 2026 [3P]                                      | Not prohibited in the excerpts found. Render advises free instances are not for production [3P] | **Spins down after 15 min without inbound traffic, ~1 min to wake** [O]. May restart any time | No                                                                                           | Starter instance $7/month (512 MB) [3P]. One pricing excerpt showed $10, so confirm | Runs `next start` unchanged. One long-lived process, so in-process bus + SSE work. Singapore region.                                                                                                                                                                                                                                                                                                                                                                       |
| Koyeb                         | One free instance (512 MB, 0.1 vCPU) [3P]                                                                                                                             | Unverified                                                                                      | Scales to zero after 1 h idle, can't disable [3P]                                             | **Yes**, $29 pre-auth hold [O FAQ]. New signups may start on Pro [3P]                        | Pro $29/month + compute [3P]. Eco-nano $1.61/month [O]                              | Rejected: card, possible removal of free signup after the Mistral acquisition (Feb 2026, [3P]).                                                                                                                                                                                                                                                                                                                                                                            |
| Fly.io                        | **No free tier for new customers**. Trial: 2 VM-hours or 7 days [O]                                                                                                   | n/a                                                                                             | n/a                                                                                           | Yes after trial [3P]                                                                         | Pay-as-you-go. Smallest machine ~$2/month [3P]                                      | Rejected for free tier. A good paid option later.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Railway                       | One-time $5 trial credit, then Free plan with $1/month credit [O]                                                                                                     | Unverified                                                                                      | Service stops when credit runs out                                                            | Unverified (sources conflict)                                                                | Hobby $5/month incl. $5 usage [O]                                                   | Rejected: $1/month can't run a 24/7 Node server.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Google Cloud Run              | 2M requests, 180,000 vCPU-s, 360,000 GiB-s per month (request-based billing), per billing account, some regions only [O]                                              | Yes                                                                                             | Scales to zero (cold start)                                                                   | **Yes**: billing account + card for identity [O]. Indian cards may fail 3-D Secure [O forum] | Pay-as-you-go above free tier ($0.40/M requests) [O]                                | **Fallback.** Runs our Docker image of `next start`. Set `max-instances=1` so the in-process bus stays correct. SSE works within the request timeout. Check the free-tier region list against Mumbai/Singapore before choosing.                                                                                                                                                                                                                                            |
| Oracle Cloud Always Free VM   | Ampere A1: **reduced to 2 OCPU / 12 GB** (from 4/24) mid-2026, per doc change [3P: InfoQ, Linuxiac]. Official page still says 4/24 in some copies. Plus AMD micro VMs | Yes                                                                                             | **Idle instances can be reclaimed** (low CPU/network/memory over 7 days) [O]                  | **Yes**, for identity check. No prepaid/virtual cards [O]                                    | Pay-as-you-go                                                                       | Second fallback. Full VM (could also run Postgres), but we would handle OS patching, TLS, deploys and uptime ourselves. A1 capacity is often unavailable in popular regions [3P].                                                                                                                                                                                                                                                                                          |

### 4.2 Recommendation

**Pilot: Render free web service (Singapore region). Move to the Render Starter instance (~$7/month) before the first paying restaurant depends on it.**

Why Render:

- No card, and no non-commercial clause found.
- It runs the plain Node server (`next start`), so nothing in the code is host-specific.
- One long-lived process matches the in-process SSE event bus and scrypt hashing.
- It sits in the same region as Neon Singapore.

**Fallback: Google Cloud Run** (needs a card) with `max-instances=1`. Second fallback: an Oracle Always Free VM.

**Risks:**

1. **Free-tier sleep.** A sleeping server drops SSE connections, and the first request after idle takes ~1 minute. Clients fall back to polling and the PWA offline queue. An uptime monitor pinging `/health` every few minutes keeps it awake (a single service 24/7 ≈ 744 h, inside 750 h). Whether that keep-alive is acceptable under Render's terms is **not verified**. Treat the free tier as pilot-only.
2. **Bandwidth.** The new Hobby allowance (reportedly 5 GB/month, $0.15/GB over) could be hit by image-heavy menus. Serve images from object storage, not through the app.
3. **Single instance.** Scaling to more than one instance needs a cross-instance bus (§5) first.
4. **Lock-in: low.** Keep a `Dockerfile` that runs `next start`, and the same image runs on Cloud Run, Fly.io, Railway or a VM.

---

## 5. Realtime: in-app SSE (decided)

**Design.** After a database commit, services publish domain events (`order.created`, `order.accepted`, ...) to `RealtimePublisher`. The first adapter is an in-process event bus. A route handler streams per-branch events as `text/event-stream` to authorized staff devices. The server checks tenant/branch authorization before subscribing. Clients refetch on reconnect, and customers poll every ~10 s. **The database is the source of truth; realtime is only a "go refetch" signal.**

**SSE limitations:**

- **Single process only.** An in-process bus doesn't reach other instances or serverless isolates. Before scaling out, add a **Postgres `LISTEN/NOTIFY` adapter** (no new vendor; needs a direct, non-pooled connection) or a vendor adapter.
- **Serverless hosts cut long streams.** Netlify's synchronous functions time out at 10 s. Vercel's duration limits conflict between sources. On Workers, sharing state needs Durable Objects. The polling fallback must work on its own.
- **Sleeping hosts** (Render free, Cloud Run scaled to zero) drop connections. EventSource reconnects, and clients refetch.
- **Proxies and buffering.** Send `Cache-Control: no-cache` and a heartbeat comment every ~20 s, and disable response compression on the stream.
- **HTTP/1.1** browsers limit open connections per origin to about 6. One SSE stream per tab is fine.

**Future vendor adapters:**

| Vendor            | Free tier                                                                                               | First paid                                          | Notes                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ably              | 6M messages/month, 200 concurrent connections, 200 channels, 500 msg/s [O]                              | Standard $29/month + usage, 10k connections [O]     | Best fit if we go multi-instance or serverless. Token auth with per-branch capabilities. |
| Pusher Channels   | Sandbox: 200,000 messages/day, 100 concurrent connections [O blog]                                      | Startup $49/month: 1M msg/day, 500 connections [3P] | Lower connection cap. 100 staff devices ≈ 10–15 restaurants.                             |
| Supabase Realtime | 200 concurrent connections, 100 messages/s [O]. A monthly message cap appears only in third-party pages | Comes with Supabase Pro $25/month                   | Only sensible if we were already on Supabase. Free project pausing applies.              |

**Recommendation:** ship SSE + polling. Add a `LISTEN/NOTIFY` adapter before running more than one app instance. Consider Ably when we need serverless hosting or more than ~150 concurrent staff devices.

---

## 6. Email

`EmailSender` interface. The dev adapter logs messages to the console and writes them to a `dev_outbox` table so tests and the UI can read them. Email is **non-critical** in the MVP: invites also work as copyable/WhatsApp links, and reminders also appear in-app and as push.

| Provider   | Free tier                                                                                                                                                                                             | Domain requirement                                                                                                                                                                                | Card                  | First paid                                            | Notes                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Brevo      | 300 emails/day, no rollover [3P, consistent]                                                                                                                                                          | Can send from a verified single sender. But a free mailbox (gmail.com) **can't be authenticated**, and Brevo rewrites the sender to a Brevo domain (`@brevosend.com` reported) [3P quoting Brevo] | No (not re-verified)  | Starter ~$9/month for 5,000 emails [3P, sources vary] | Works with no domain, but deliverability is weak. Use it only until a domain exists. |
| **Resend** | 3,000/month, **100/day**, 1 domain (one tracker says 3) [3P]                                                                                                                                          | **Verified domain required** to email anyone other than yourself [O, from the earlier check]                                                                                                      | No (not re-verified)  | Pro $20/month for 50,000, no daily cap [O]            | Clean API, good DX. 100/day is enough for invites and reminders at pilot scale.      |
| Mailjet    | 6,000/month, 200/day (extra queued to next day) [O]                                                                                                                                                   | Unverified                                                                                                                                                                                        | Unverified            | Starter ~$9/month for 8,000 [O, FR page]              | Free emails carry Mailjet branding [3P].                                             |
| Amazon SES | $0.10 per 1,000 [3P, consistent]. The old 3,000/month free tier **may not apply to new accounts** (accounts after 15 Jul 2025 get AWS credits instead; plans restructured Jul 2026) [3P, conflicting] | Verified domain or address. New accounts start in a sandbox (send only to verified recipients) until production access is granted (not re-verified)                                               | **Yes** (AWS account) | Pay-as-you-go                                         | Cheapest at volume, most setup. Consider it at 50+ restaurants.                      |

**Recommendation:** console/DB adapter now. For production, **buy a domain** (the one paid item worth doing early; price not checked here) and use **Resend Free**, with SPF/DKIM/DMARC set up. Until the domain exists, use Brevo free and accept weak deliverability.

**Risks:** the 100/day Resend cap (queue and retry, and send invites in batches); spam-folder delivery without DMARC; templates should stay in our code, not in the vendor's dashboard, to avoid lock-in.

---

## 7. File / image storage

`ObjectStorage` interface. The dev adapter writes to `./.data/uploads` and serves through a route handler. Production uses the S3 API (`@aws-sdk/client-s3`, presigned PUT/GET), so R2, B2 and MinIO share one adapter. The database stores **object keys only**. Images are resized in the browser to ~200 KB before upload and validated on the server (type sniffing, size limits).

| Provider          | Free tier                                                                                      | Egress                                                     | Card                                                      | First paid / overage                                    | Lock-in                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| **Cloudflare R2** | 10 GB-month Standard storage, 1M Class A + 10M Class B ops/month [O]                           | **Free** [O]                                               | **Yes**: card or PayPal to enable R2 [3P, several guides] | ~$0.015/GB-month, $4.50/M Class A, $0.36/M Class B [3P] | Low (S3 API)                                                |
| Backblaze B2      | First 10 GB free [3P, most sources]                                                            | Free up to 3× stored data, then $0.01/GB [3P]              | Reportedly no for the free 10 GB (not re-verified)        | ~$6/TB-month [3P]                                       | Low (S3-compatible API)                                     |
| Supabase Storage  | 1 GB (some sources 500 MB) [3P, conflicting]                                                   | Free plan: 5 GB cached + 5 GB uncached, shared with DB [O] | No                                                        | With Supabase Pro                                       | Medium (own API; S3 protocol also offered, not re-verified) |
| UploadThing       | 2 GB [3P]. Free tier was **dropped in Jan 2025 and appears again in 2026 listings** (volatile) | Unverified                                                 | Unverified                                                | $10/month for 100 GB [3P]                               | **High** (own SDK and URLs)                                 |

**Recommendation:** Cloudflare R2 if the owner can add a card (free egress suits menu images). Otherwise Backblaze B2 through the same adapter. Rejected: UploadThing (lock-in, unstable free tier) and Supabase Storage (small, pausing).

**Risks:** R2's card requirement; B2 transaction caps (a 2,500/day free allowance on some call classes [3P]), so put a CDN or long `Cache-Control` in front of public images; keep presigned URL lifetimes short.

---

## 8. Push notifications

Standard **Web Push with VAPID keys** (`web-push` library) behind `PushSender`. No vendor account or quota. Browsers deliver through their own push services. Subscriptions are stored per user/device in Postgres and removed when the push service returns 404/410.

**iOS limits:**

- Push works only for a web app **added to the Home Screen** on iOS/iPadOS 16.4+.
- Users can't subscribe before installing, and Safari has no automatic install prompt (`beforeinstallprompt`). The app must show "Add to Home Screen" instructions.
- **EU:** Apple first said Home Screen web apps would be removed in iOS 17.4, then reversed that decision. One 2026 third-party guide still claims EU PWAs lack push, which looks outdated. Not an issue for India-first users.

**Other risks:** a notification permission prompt must come from a user gesture; delivery is best-effort (kitchen tickets must never rely on push alone; SSE/polling is the primary path); keep VAPID private keys only in server secrets.

---

## 9. Monitoring and logging

- **Logs:** structured JSON to stdout (one line per event) with request ID, workspace/branch IDs and route. Never secrets, tokens or PII. The host captures stdout (Render log viewer). No log vendor is needed for the pilot.
- **Errors:** an `ErrorReporter` interface. The console adapter is the default, and a Sentry adapter is added at go-live.

| Service              | Free tier                                                                                     | Card       | First paid                                          | Notes                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sentry Developer** | 5,000 errors, 5M spans/month, **1 user** [3P, consistent]                                     | No [3P]    | Team $26/month annual, $29 monthly, 50k errors [3P] | Commercial use on Developer plan: **unverified** (check terms). Next.js SDK. Keep it behind `ErrorReporter`.                                                 |
| Better Stack         | 3 GB logs with 3-day retention, 10 monitors + 10 heartbeats, 3-min checks, 1 status page [3P] | Unverified | Responder $29/month annual, $34 monthly [3P]        | Use the free **uptime monitor** on `/health` (it also keeps the Render free instance awake). Third-party sources call the free plan "for personal projects". |
| Grafana Cloud        | 10k metrics series, 50 GB logs, 50 GB traces, 14-day retention, 3 users [O/3P]                | No [3P]    | Pro from $19/month + usage [3P]                     | Most generous for logs. Needs an agent or OTLP exporter. Consider it when stdout logs aren't enough.                                                         |

**Recommendation:** stdout JSON logs + Sentry Developer (errors) + Better Stack free (uptime). Switch to Grafana Cloud for log search if needed.

---

## 10. Background jobs

Jobs are **route handlers** under `/api/internal/jobs/*`, protected by a secret header (constant-time compare). They are idempotent and safe to run twice or late. **Subscription status is computed from dates at read time**, so a missed job can never wrongly grant or block access. Jobs only send reminders, sweep retention and verify backups.

| Caller                   | Free limits                                                                                                                       | Reliability                           | Card   | Notes                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| **cron-job.org**         | Free. Up to every minute. 30 s timeout. 64 KB output read [O FAQ]                                                                 | Good. Has execution history           | No     | Commercial-use terms **unverified**. Endpoints must return within 30 s, so jobs enqueue and process in batches. |
| GitHub Actions schedule  | Min interval 5 min. **Best-effort, 5–30+ min delays**. Disabled after 60 days without repo activity (public repos) [3P]           | Low for timing. Fine for nightly work | No     | Best for the nightly `pg_dump` backup (needs a runner with `pg_dump`).                                          |
| Cloudflare Cron Triggers | 5 cron triggers/account on Free [O]. Uses Workers free requests                                                                   | Good                                  | No     | Needs a tiny Worker that calls our endpoint. One more platform to manage.                                       |
| Host-native cron         | Render cron jobs are paid (not re-verified). Cloud Scheduler with Cloud Run (free allowance not re-verified). `cron` on Oracle VM | Good                                  | Varies | Use it if we move to a paid host.                                                                               |

**Recommendation:** cron-job.org calls the job endpoints. GitHub Actions runs the nightly backup and serves as a second caller for daily jobs.

---

## 11. Migration strategy and lock-in summary

Every replaceable capability has `interfaces/` and `providers/<name>/` under `src/infrastructure/<capability>/`. One composition root picks providers from env config. ESLint blocks imports of providers from `src/app`, `src/features` and `src/components`. Swapping a provider means:

1. Write the adapter.
2. Pass the shared contract tests for that interface.
3. Change the env var.
4. For data-bearing capabilities (DB, storage), run a copy/migration script.

| Capability    | Lock-in risk | Exit path                                                                       |
| ------------- | ------------ | ------------------------------------------------------------------------------- |
| Postgres host | Low          | `pg_dump`/`pg_restore`, change `DATABASE_URL`. Avoid host-only extensions/APIs. |
| Hosting       | Low          | Same Docker image / `next start` anywhere.                                      |
| Auth          | None         | In-app; users in our DB.                                                        |
| Realtime      | None today   | Vendor adapter later behind `RealtimePublisher`.                                |
| Email         | Low          | Templates in our code. DNS records move with the domain.                        |
| Storage       | Low          | S3 API. Copy objects with `rclone`; keys unchanged.                             |
| Errors        | Low          | `ErrorReporter` adapter swap.                                                   |

---

## 12. Backups and recovery

A nightly GitHub Actions workflow runs `pg_dump --format=custom` against the production database (read-only role), encrypts the dump, and uploads it to a private bucket with separate credentials. It keeps 30 daily and 12 monthly dumps. A monthly restore drill loads the latest dump into a local Postgres 16 and runs the smoke tests. Details go in `docs/deployment.md`.

---

## 13. Cost growth (estimates)

USD is primary. ₹ uses an **assumed ₹90 = $1** (not checked). Paid-tier prices come from §2–§10 and inherit their source quality. Usage-based lines are rough estimates.

| Stage                   | What changes                                                                                                                                                                                                             | Est. USD/month | Est. ₹/month       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------ |
| Pilot (1–5 restaurants) | All free: Render free, Neon Free, Brevo/Resend free, R2/B2 free, Sentry Developer, cron-job.org. Optional domain (price not checked)                                                                                     | **$0**         | **₹0**             |
| 10–30 restaurants       | Render Starter (always on) $7–10. Neon Launch: about 0.25–0.5 CU average × 730 h × $0.106 ≈ $19–39, plus storage under $1. Resend Free still OK. Domain ~$1                                                              | **~$27–50**    | **~₹2,400–4,500**  |
| 50–150 restaurants      | Bigger Render instance (price not checked; assume ~$25). Neon ~0.5–1 CU average ≈ $39–77 + storage. Resend Pro $20. Sentry Team $26–29. Optional Ably Standard $29 if we leave single-instance SSE. R2 overage (a few $) | **~$110–180**  | **~₹9,900–16,200** |

**Upgrade triggers to watch:** Neon storage above 60% or CU-hours above 70% of the allowance. Render bandwidth or memory. Resend 100/day cap. Sentry quota. Concurrent SSE connections per instance. Needing a second app instance (add `LISTEN/NOTIFY` first).

### Nothing activated

**No account has been created, no key generated and no paid service activated for this project.** The codebase contains only local adapters (local Postgres/PGlite, console email, filesystem storage, in-process realtime, console error reporter). Before production, the **owner** must sign up for (free tiers unless noted):

1. **Neon** (Free): create a project in `aws-ap-southeast-1` and copy the pooled + direct connection strings.
2. **Render** (Hobby workspace, free web service, Singapore). Plan the move to a Starter instance (paid) before paying customers depend on it.
3. **A domain name** (paid, small yearly fee). Then set up **Resend** (Free) with SPF/DKIM/DMARC. Until then, **Brevo** (Free) with a verified sender.
4. **Cloudflare R2** (needs a card or PayPal) **or Backblaze B2** (no card reported).
5. **Sentry** (Developer, free) and **Better Stack** (free uptime monitor).
6. **cron-job.org** (free) and a GitHub Actions secret set for the backup workflow.
7. Generate **VAPID keys** and app secrets locally. No vendor is involved.

Fallbacks that need a card (Google Cloud Run, Oracle Cloud, Koyeb, AWS SES) should only be activated after the owner decides to.

---

## 14. Sources (checked 2026-11-04 via web search excerpts; direct page fetch was blocked)

**Database**

- Neon free plan limits (FAQ): https://neon.com/faqs/free-plan-limits-and-quotas
- Neon free plan 1 GB/project (blog, Oct 2026): https://neon.com/blog/neon-free-plan-1-gb-per-project ; changelog: https://neon.com/docs/changelog/2026-10-02
- Neon plans / pricing: https://neon.com/docs/introduction/plans , https://neon.com/pricing
- Neon free tier, no card: https://neon.com/faqs/managed-postgres-databases-free-tier
- Neon regions: https://neon.com/docs/introduction/regions
- Neon serverless driver: https://neon.com/docs/serverless/serverless-driver ; Drizzle + Neon: https://orm.drizzle.team/docs/connect-neon
- Neon Launch rates and minimum (third-party): https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026 , https://www.jetadmin.io/blog/neon-pricing/
- Supabase pricing: https://supabase.com/pricing ; pausing: https://supabase.com/docs/guides/platform/free-project-pausing ; storage egress: https://supabase.com/docs/guides/storage/serving/bandwidth
- Supabase pricing summaries (third-party): https://makerkit.dev/blog/saas/supabase-pricing , https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
- Aiven free tier: https://aiven.io/docs/products/postgresql/concepts/pg-free-tier , https://aiven.io/free-tier , https://aiven.io/blog/free-plans-postgresql-mysql-redis
- Aiven connection limits: https://aiven.io/docs/products/postgresql/reference/pg-connection-limits ; Developer tier: https://aiven.io/blog/new-developer-tier-for-aiven-for-postgres
- Prisma Postgres: https://www.prisma.io/postgres/free-postgresql-hosting , https://www.prisma.io/pricing , https://www.prisma.io/docs/data-platform/billing/manage-plans
- CockroachDB Basic pricing: https://www.cockroachlabs.com/docs/cockroachcloud/plan-your-cluster-basic ; RLS: https://www.cockroachlabs.com/docs/stable/row-level-security
- Xata free tier status (third-party): https://agentdeals.dev/digest/2026-w15 , https://share.transistor.fm/s/22f9c21d , https://www.srvrlss.io/provider/xata/
- Render free Postgres: https://render.com/docs/free

**Hosting**

- Vercel Hobby commercial restriction: https://vercel.com/docs/limits/fair-use-guidelines , https://vercel.com/docs/plans/hobby
- Netlify credit plans: https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans/ ; Next.js support: https://docs.netlify.com/integrations/frameworks/next-js/overview/ ; function timeout: https://answers.netlify.com/t/support-guide-why-is-my-function-timing-out/71689/1
- Netlify free-plan details (third-party): https://netli.fyi/blog/netlify-free-plan-limits-2026 , https://makerkit.dev/pricing-calculator/netlify
- Cloudflare Workers limits / pricing: https://developers.cloudflare.com/workers/platform/limits , https://developers.cloudflare.com/workers/platform/pricing/
- Hyperdrive pricing: https://developers.cloudflare.com/hyperdrive/platform/pricing
- Workers `node:crypto`: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto
- OpenNext Cloudflare: https://opennext.js.org/cloudflare ; Next.js 16 / middleware status (Vercel, competitor): https://vercel.com/kb/guide/next-js-on-vercel-vs-cloudflare ; 64 MB size report: https://dev.classmethod.jp/en/articles/cloudflare-workers-64mib-size-limit/
- Render free tier: https://render.com/docs/free ; new workspace plans: https://render.com/docs/new-workspace-plans ; bandwidth: https://render.com/docs/outbound-bandwidth ; pricing summary (third-party): https://jwatte.com/blog/render-com-platform-review/
- Koyeb pricing FAQ: https://www.koyeb.com/docs/faqs/pricing ; instances: https://www.koyeb.com/docs/reference/instances ; signup change (competitor): https://snapdeploy.dev/koyeb-alternative
- Fly.io: https://fly.io/docs/about/discontinued-plans/ , https://fly.io/docs/about/free-trial/
- Railway: https://docs.railway.com/pricing/plans
- Google Cloud Run pricing: https://cloud.google.com/run/pricing ; free features and card requirement: https://docs.cloud.google.com/free/docs/free-cloud-features
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm ; FAQ (card): https://www.oracle.com/cloud/free/faq/ ; A1 reduction reports: https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/ , https://www.linuxtoday.com/blog/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/

**Auth**

- Clerk pricing: https://clerk.com/articles/clerk-pricing-explained

**Realtime**

- Ably free package / pricing: https://ably.com/docs/platform/pricing/free , https://ably.com/pricing
- Pusher Sandbox limits: https://pusher.com/blog/making-it-cheaper-to-get-started/ ; Startup plan (third-party): https://ably.com/topic/pusher-pricing
- Supabase Realtime limits: https://supabase.com/docs/guides/realtime/limits

**Email**

- Brevo free limits / sender rewrite (third-party): https://dreamlit.ai/blog/brevo-review , https://www.captaindns.com/en/blog/brevo-transactional-email-technical-guide
- Resend pricing: https://www.resend.com/pricing ; domain requirement: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- Mailjet pricing: https://www.mailjet.com/pricing/ ; daily limit: https://documentation.mailjet.com/hc/en-us/articles/360043048393
- Amazon SES pricing changes (third-party): https://dev.to/mr_manushukla/amazon-ses-pricing-plans-in-2026-essentials-vs-pro-vs-enterprise-and-when-a-la-carte-still-wins-1ohg , https://www.usecarly.com/blog/amazon-ses-pricing/

**Storage**

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing ; card to enable (third-party): https://tech-insider.org/how-to-set-up-cloudflare-r2-2026/
- Backblaze B2 (third-party): https://upstash.com/blog/backblaze-b2-pricing-explained-2026.md
- UploadThing: https://uploadthing.com/pricing ; Jan 2025 change: https://agentdeals.dev/digest/2025-w03

**Push**

- iOS web push limits: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide ; EU reversal: https://www.engadget.com/apple-backtracks-on-plans-to-get-rid-of-web-apps-on-iphones-in-the-eu-195232177.html

**Monitoring**

- Sentry pricing (third-party): https://cubeapm.com/blog/sentry-pricing-review/ , https://last9.io/blog/sentry-pricing/
- Better Stack: https://betterstack.com/pricing ; summary (third-party): https://cubeapm.com/blog/betterstack-pricing-review/
- Grafana Cloud free tier: https://grafana.com/products/cloud/free-tier ; pricing summary: https://last9.io/blog/grafana-cloud-pricing/

**Jobs**

- cron-job.org FAQ: https://cron-job.org/faq/
- GitHub Actions schedule behavior (third-party): https://cronuru.com/guides/github-actions-scheduled-workflows , https://runhooks.app/blog/github-actions-scheduled-workflows-unreliable/
- Cloudflare Cron Trigger limits: https://developers.cloudflare.com/workers/platform/limits
