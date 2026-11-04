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

## Built by stopped agents — needs review ⚠️

- [ ] Tenancy APIs (restaurants, branches, settings, members, invitations, roles) — server + tests present; **UI pages removed**: onboarding wizard, members, workspace settings, branch settings, branch staff, account, invite acceptance. Restaurants list/detail pages present.
- [ ] Menu + tables + QR + uploads — APIs/tests present; menu & tables pages present, QR dialog may be incomplete
- [ ] Customer QR ordering (`/t/[token]`) — APIs/tests present; UI state unverified
- [ ] Waiter / kitchen consoles, order transitions, SSE — APIs/tests present; UI unverified
- [ ] Billing + cashier — server done; cashier/bills UI partially written
- [ ] Platform: plans, settings, Super Admin, support, audit, jobs, test clock — partially written; **seed script (`scripts/seed.ts`) may be missing/incomplete**
- [ ] Public site + auth pages — mostly done (19 unit tests); verify pages
- [ ] Analytics APIs + dashboards — partially written

## Next steps (in order)

1. Run the app and click through each area; fix broken pages:
   ```bash
   pnpm install && cp .env.example .env.local && pnpm db:migrate && pnpm dev
   ```
2. Finish/verify the seed script (`pnpm db:seed`) for demo logins and data.
3. Rebuild the removed tenancy UI pages (onboarding wizard first — it is the main entry flow).
4. Mount `SyncStatusIndicator`/`OfflineBanner` in waiter, kitchen, cashier layouts; mount the announcement bar in shells.
5. Playwright E2E workflows A–I (only site specs exist).
6. Hardening: Postgres RLS, S3 storage adapter, multi-instance realtime (LISTEN/NOTIFY), Sentry adapter.
7. Write `README.md` refresh, `deployment.md`, `testing.md`.
