# Implementation Roadmap — status

Last updated: 2026-11-04. Verified on this commit: `tsc` 0 errors, ESLint 0 errors (3 React Compiler warnings), **349 Vitest tests passing (41 files)**, `next build` passes.

Module agents were stopped early at the owner's request (credit limit). Their server code (APIs + services + tests) is largely complete; several UI pages were unfinished and were **removed** so the build stays green. Items below marked ⚠️ have code in the repo that has not been reviewed end-to-end.

## Done ✅

- [x] Phase 0 audit; Phase 1 decisions (`technology-decisions.md`: PostgreSQL/Drizzle, in-app auth, SSE realtime, Neon + Render recommended, nothing paid activated)
- [x] Full schema (45 tables) + migration + `ensureSystemData` (permissions, system roles, default plans/settings)
- [x] Domain rules with unit tests: pricing (variants/add-ons/min-max), order state machine, bill calculator (tax incl./excl., discount, service charge), payment ledger, entitlements/trial→grace→read-only, permissions
- [x] Provider ports + dev adapters: identity (scrypt + hashed sessions), email (outbox/Resend/Brevo), storage (local), realtime (memory bus), push (noop), logging
- [x] HTTP wrapper: CSRF origin check, DB rate limits, Zod validation, idempotency replay, safe errors
- [x] Auth API (sign up/in/out, me, forgot/reset, verify email, change password, switch workspace)
- [x] Workspaces + trial start, tenant access service (404 across tenants), structure/branch-context APIs
- [x] Design system UI kit + feedback components; dashboard / workspace / branch shells; proxy redirect
- [x] Offline layer: Dexie cache, sync outbox engine (backoff, idempotency, conflicts), sync indicator + offline banner (mounted in dashboard shell), service worker rules, `/~offline`, `docs/offline-sync.md`
- [x] Notifications API + bell + `/app/notifications` + preferences; push plumbing (disabled by default)
- [x] Docs: architecture, api-reference, provider-abstractions, provider-migration-guide, tenant-security, database-schema, environment-variables, offline-sync

## Update (later session)

- [x] Onboarding wizard rebuilt (`/app/onboarding`): workspace → restaurant+branch → first menu item → bulk tables → done; progress saved and resumable
- [x] `pnpm db:seed` (demo owner/staff/admin, 2 branches, 6-category menu with variants and add-ons, 12 tables each with QR) and `pnpm db:make-admin <email>`
- [x] **Verified end to end over HTTP against the running server:** QR scan → session → order → waiter accept → kitchen start/ready → serve → bill with GST → two partial payments (UPI + cash) → PAID → idempotent payment replay → session closed; role denials (cashier/waiter/kitchen) confirmed

## Browser walkthrough (headless Chromium, production build, seeded data)

Signed in as owner and Super Admin and opened every main screen: workspace (overview, restaurants, members, analytics, subscription, audit, support, settings), branch (overview, menu, tables, orders, bills, staff, settings, reports), waiter, kitchen, cashier, notifications, account, admin (overview, workspaces, plans, support, settings). All render with no 404s or server errors. Fixed in this pass: missing route files for subscription/support/audit/admin pages and the admin layout; added admin workspace detail, read-only plans page and platform settings form. Fixed: hydration mismatch (#418) caused by offline-cache restore racing hydration (AuthGate now renders the server skeleton until hydrated). admin plan editing and announcements UI are not built (APIs exist); screens were checked for loading/errors, not pixel-reviewed.

## Built by stopped agents — needs review ⚠️

- [ ] Tenancy APIs (restaurants, branches, settings, members, invitations, roles) — server + tests present; UI pages rebuilt (see above); not browser-verified. Role create/edit UI not built (roles are listed read-only).
- [ ] Menu + tables + QR + uploads — APIs/tests present; menu & tables pages present, QR dialog may be incomplete
- [ ] Customer QR ordering (`/t/[token]`) — APIs/tests present; UI state unverified
- [ ] Waiter / kitchen consoles, order transitions, SSE — APIs/tests present; UI unverified
- [ ] Billing + cashier — server done; cashier/bills UI partially written
- [ ] Platform: plans, settings, Super Admin, support, audit, jobs, test clock — partially written; **seed script (`scripts/seed.ts`) may be missing/incomplete**
- [ ] Public site + auth pages — mostly done (19 unit tests); verify pages
- [ ] Analytics APIs + dashboards — partially written

## Next steps (in order)

1. Run the app and click through each area in a browser; fix broken pages (APIs are verified, screens are not):
   ```bash
   pnpm install && cp .env.example .env.local && pnpm db:migrate && pnpm db:seed && pnpm dev
   ```
2. ~~Rebuild removed tenancy pages~~ — done (members/invitations/roles, workspace settings, branch settings incl. taxes & hours, branch staff, account, invite acceptance). Invite create → accept → re-accept rejected verified over HTTP.
3. Mount `SyncStatusIndicator`/`OfflineBanner` in waiter, kitchen, cashier layouts; mount the announcement bar in shells.
4. Playwright E2E workflows A–I (only site specs exist).
5. Hardening: Postgres RLS, S3 storage adapter, multi-instance realtime (LISTEN/NOTIFY), Sentry adapter.
6. Write `README.md` refresh, `deployment.md`, `testing.md`.
