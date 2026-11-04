# Deployment

RestaurantOS is a standard Node server: `pnpm build && pnpm start`. No host-specific APIs are used.

## Requirements

- Node 22+, PostgreSQL 16 (managed or self-hosted, TLS enabled)
- **One long-running instance** while `REALTIME_PROVIDER=memory` (live updates are in-process; clients also poll, so a second instance degrades to polling, it does not break)
- Persistent disk for `STORAGE_LOCAL_DIR`, or implement the S3 adapter first ([migration guide](provider-migration-guide.md)) — uploads are lost on ephemeral disks
- HTTPS (cookies become `Secure`; the PWA and service worker need it)

## Steps

1. Create the database; set `DATABASE_URL` (see [environment variables](environment-variables.md)).
2. Set production variables: `NODE_ENV=production`, `APP_URL=https://your-domain`, `APP_SECRET` (random, 32+ chars — rotating it invalidates stored QR ciphertexts), `CRON_SECRET`, email provider keys. `ENABLE_TEST_HOOKS` must stay `false` (startup fails otherwise).
3. `pnpm install --frozen-lockfile && pnpm build`.
4. `pnpm db:migrate` (migrations + reference data; safe to re-run). Do **not** run `db:seed` in production.
5. Create the first Super Admin: sign up normally, then `pnpm db:make-admin <email>` with production env.
6. `pnpm start` behind a reverse proxy that sets `X-Forwarded-For`.
7. Schedule `POST https://your-domain/api/v1/jobs/subscriptions` daily with `Authorization: Bearer $CRON_SECRET` (trial reminders and expiry notices; access is computed from dates, so a missed run changes nothing).

## Provider recommendation (verify before signing up)

See [technology decisions](technology-decisions.md): Neon free Postgres (Singapore) + Render free web service for a pilot; free tiers sleep when idle and have storage limits — move to paid before real restaurants depend on it. Facts in that document came partly from search summaries and must be re-checked on the providers' pages. Nothing paid has been activated.

## Backups and recovery

- Nightly: `pg_dump --format=custom "$DATABASE_URL" > backup-$(date +%F).dump` (GitHub Actions or host cron), stored in a separate account/bucket, 30 days retention.
- Restore drill monthly: `createdb restore_test && pg_restore --no-owner -d restore_test backup.dump`, then start the app against it.
- Uploaded files: back up `STORAGE_LOCAL_DIR` (or bucket versioning).
- Free managed tiers often have limited or no point-in-time recovery; do not rely on it.

## Data retention

Expired or suspended workspaces keep their data (read-only or blocked). Nothing is deleted automatically. Deleting a workspace on request is a manual, audited operation; disclose retention in the Privacy Policy (the legal pages are templates to be reviewed by a lawyer).

## Before going live (not done yet)

Postgres row-level security, S3-compatible storage, multi-instance realtime, error monitoring (Sentry adapter), browser E2E tests, load test, review of the legal templates.
