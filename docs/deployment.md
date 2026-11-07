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
8. Optional: online payments, see [Razorpay setup](#razorpay-setup).

## Razorpay setup

Online subscription payments are off until `PAYMENT_PROVIDER=razorpay` is set. Until then the Subscription page offers the manual upgrade request only, and a Super Admin activates plans by hand. Prepaid periods use Razorpay **Orders** plus Standard Checkout: one order per period, activated once the payment is captured. Automatic recurring renewal (Razorpay Subscriptions) is not part of this.

1. **Keys.** In the Razorpay dashboard open _Account & Settings → API Keys_. Generate **test mode** keys first (`rzp_test_...`); switch to live keys only after the end-to-end check below. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the server environment (never in the client or in git).
2. **Webhook.** _Account & Settings → Webhooks → Add new webhook_:
   - URL: `https://<console-or-api-host>/api/v1/webhooks/razorpay` (the host that serves the API; the route is public, needs no cookie and is exempt from the same-origin check and maintenance mode).
   - Secret: choose a long random string and put the same value in `RAZORPAY_WEBHOOK_SECRET`.
   - Active events: `order.paid` and `payment.captured`. Other events are acknowledged and ignored.
     Webhooks are configured per mode: create one with the test keys and again when going live.
3. Set `PAYMENT_PROVIDER=razorpay` and restart. Startup fails if any of the three variables is missing.
4. **Test-mode check.** Sign in as an organization owner, open _Subscription → Upgrade_, choose a plan and billing cycle and press **Pay with Razorpay**. Pay with a Razorpay test card (for example `4111 1111 1111 1111`, any future expiry, any CVV; for a failing card use `4000 0000 0000 0002` or the "Failure" option in test Checkout). The plan is activated by the verify call that follows a successful payment, or by the webhook — whichever arrives first; the other is a no-op. Confirm the Subscription page shows the plan ACTIVE with the new period end, the history shows "Payment received", and the audit log holds `subscription.paid`. In the dashboard's _Webhooks_ page, every delivery should show 2xx; a 401 means the webhook secret differs between the dashboard and `RAZORPAY_WEBHOOK_SECRET`.
5. **Amounts.** The price charged is always the plan's `monthlyPrice` / `annualPrice` from the database (minor units, INR), never a client value. A payment whose amount differs from the stored order is never activated; it is audited as `payment.amount_mismatch` for a Super Admin to settle by hand.

## Provider recommendation (verify before signing up)

See [technology decisions](technology-decisions.md): Neon free Postgres (Singapore) + Render free web service for a pilot; free tiers sleep when idle and have storage limits — move to paid before real restaurants depend on it. Facts in that document came partly from search summaries and must be re-checked on the providers' pages. Nothing paid has been activated.

## Backups and recovery

- Nightly: `pg_dump --format=custom "$DATABASE_URL" > backup-$(date +%F).dump` (GitHub Actions or host cron), stored in a separate account/bucket, 30 days retention.
- Restore drill monthly: `createdb restore_test && pg_restore --no-owner -d restore_test backup.dump`, then start the app against it.
- Uploaded files: back up `STORAGE_LOCAL_DIR` (or bucket versioning).
- Free managed tiers often have limited or no point-in-time recovery; do not rely on it.

### Restoring as a different user

`pnpm db:restore` does not require the restoring user to be the dump's owner (for example a PGlite dump owned by `postgres` restored into a managed Postgres as `ros_owner`). Objects are re-owned by the restoring user (`--no-owner`), and the dump's own `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` entries are replayed without `FOR ROLE`, so later migrations run by that user still hand the tenant roles their grants. Grants and row-level security policies come from the dump, never from re-applied migration files. The restoring user needs `CREATEROLE` on a cluster without `ros_tenant`/`ros_runtime` (it creates them and so holds the ADMIN option); if the roles already exist, it needs the ADMIN option on `ros_tenant` or the memberships granted by an admin beforehand (`GRANT ros_tenant TO ros_runtime; GRANT ros_tenant TO <user>;`), otherwise the restore refuses with exit 3 before writing anything. Pair the restore with a client of the server's major version (`PG_DOCKER_CONTAINER=<postgres:18 container>` runs `pg_restore`/`psql` from the server's image).

## Data retention

Expired or suspended workspaces keep their data (read-only or blocked). Nothing is deleted automatically. Deleting a workspace on request is a manual, audited operation; disclose retention in the Privacy Policy (the legal pages are templates to be reviewed by a lawyer).

## Before going live (not done yet)

Postgres row-level security, S3-compatible storage, multi-instance realtime, error monitoring (Sentry adapter), browser E2E tests, load test, review of the legal templates.
