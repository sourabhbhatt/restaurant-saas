# Deployment

RestaurantOS deploys as four containers built from one Dockerfile: `api`, `console`, `ops`, `admin`. Each is a standalone Next.js server; no host-specific APIs are used. Only the API reaches the database, storage, email and payment providers. Any app can be redeployed alone.

## Requirements

- Node 22+ (images use `node:22-slim`), **PostgreSQL 18** (managed or self-hosted, TLS enabled). The local PGlite data is PostgreSQL 18, and a `pg_dump` is not guaranteed to restore into an older major.
- Shared object storage: `STORAGE_PROVIDER=s3` (any S3-compatible bucket). Local storage needs a persistent disk and a single API instance.
- `REALTIME_PROVIDER=postgres` when more than one API instance can run; `memory` only works within one process (clients also poll, so a second instance degrades to polling, it does not break).
- HTTPS on every public origin (cookies become `Secure`; the PWA and service worker need it).
- Three public origins (console, ops, admin) and an internal URL for the API. The API itself needs a public URL only for the Razorpay webhook: the frontends' `/api/v1` proxy forwards a fixed list of request headers that does not include `X-Razorpay-Signature`, so a webhook sent through it fails verification.

## Images

```bash
docker build -f infra/docker/next-app.Dockerfile --build-arg APP=api     -t ros-api:<tag> .
docker build -f infra/docker/next-app.Dockerfile --build-arg APP=console -t ros-console:<tag> .
docker build -f infra/docker/next-app.Dockerfile --build-arg APP=ops     -t ros-ops:<tag> .
docker build -f infra/docker/next-app.Dockerfile --build-arg APP=admin   -t ros-admin:<tag> .
# one-shot migration image (runs `pnpm migrate` in packages/database)
docker build -f infra/docker/next-app.Dockerfile --build-arg APP=api --target migrate -t ros-migrate:<tag> .
```

The build prunes the workspace to the app (`turbo prune @ros/<app> --docker`), installs with `--frozen-lockfile` and runs `turbo run build --filter=@ros/<app>`. The runner listens on `PORT` (default 3000; set `PORT=4000` for the API if you keep the local port), runs as user `app` and has a `HEALTHCHECK` on `/api/v1/health` (api) or `/healthz` (frontends). The API image contains the migration files at `/app/packages/database/src/providers/postgres/migrations`, which `/api/v1/health/ready` reads to report pending migrations; keep that path.

Health endpoints: `/api/v1/health` (liveness, reports `APP_VERSION`), `/api/v1/health/ready` (database answers and every migration is applied; 503 otherwise), `/healthz` on each frontend.

## Docker compose

`infra/compose/docker-compose.yml` is the local parity stack and the VPS exit target: `postgres:18`, `minio/minio`, a one-shot `minio-init` (creates the bucket), a one-shot `migrate` (as the database owner), a one-shot `roles` (gives `ros_runtime` a login via `init-roles.sql`), then `api`, `console`, `ops`, `admin` (none published) behind a `caddy` edge that publishes :3000 (console), :3001 (ops) and :3002 (admin) and overwrites `X-Forwarded-For` with the real client address (`infra/compose/Caddyfile`; for a VPS put your hostnames there and Caddy provisions TLS).

```bash
cp infra/compose/.env.compose.example infra/compose/.env.compose   # replace every placeholder
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose up -d --build
docker compose -f infra/compose/docker-compose.yml ps     # migrate, roles, minio-init exited 0; the rest healthy
pnpm smoke --base-url http://localhost:3000
```

The API runs with `DATABASE_URL` as `ros_runtime`, `DATABASE_TENANT_ROLE=ros_tenant`, `REALTIME_PROVIDER=postgres`, `STORAGE_PROVIDER=s3` (MinIO, `S3_FORCE_PATH_STYLE=true`), `TRUSTED_PROXY_HOPS=1`, `ALLOWED_ORIGINS` = the three frontend origins, `COOKIE_SECURE=false` (plain HTTP on localhost; put TLS in front and remove it on a VPS). Redeploy one app: `docker compose … up -d --build admin`.

## Steps (any host)

1. Create the database with an owner user; set the migration `DATABASE_URL` to the owner (see [environment variables](environment-variables.md)).
2. Run migrations once per release, before the new API starts: the `migrate` image, or `pnpm db:migrate` from a checkout. Migrations are additive and safe to re-run. Do **not** run `db:seed` in production.
3. Give `ros_runtime` a login: `ALTER ROLE ros_runtime LOGIN PASSWORD '…'; GRANT CONNECT ON DATABASE <db> TO ros_runtime;` (what `init-roles.sql` does). The API's `DATABASE_URL` uses it.
4. API environment: `NODE_ENV=production`, `APP_URL=https://<console origin>`, `ALLOWED_ORIGINS=https://<console>,https://<ops>,https://<admin>`, `TRUSTED_PROXY_HOPS` (count your proxies, see the env doc), `APP_SECRET` (random, 32+ chars; rotating it invalidates stored QR ciphertexts), `CRON_SECRET`, storage, email and payment settings, `REALTIME_PROVIDER=postgres`, `APP_VERSION`. `ENABLE_TEST_HOOKS` must stay `false` (startup fails otherwise).
5. Frontend environment: `API_INTERNAL_URL`, `CONSOLE_URL`, `OPS_URL`, `ADMIN_URL`, `APP_VERSION`.
6. Create the first Super Admin: sign up on the console, then `pnpm db:make-admin <email>` with the owner `DATABASE_URL`.
7. Schedule `POST <API URL>/api/v1/jobs/subscriptions` daily with `Authorization: Bearer $CRON_SECRET`, sent to the API directly (the frontends' proxy does not forward `Authorization`) (trial reminders and expiry notices; access is computed from dates, so a missed run changes nothing).
8. Optional: online payments, see [Razorpay setup](#razorpay-setup).

## Cloud Run notes

The target in the [platform design](superpowers/specs/2026-11-07-platform-split-and-gcp-design.md) is Cloud Run (`asia-south1`) with Cloud SQL for PostgreSQL 18. Nothing in `infra/` provisions it yet; these are the settings the code needs:

- One Cloud Run service per app from the images above; the `migrate` image as a Cloud Run Job, executed before each API rollout. Set `PORT` from Cloud Run's injected value (the images read it).
- The API can be internal-only (ingress "internal") when the frontends reach it over the VPC; `API_INTERNAL_URL` is then its internal URL. With `PAYMENT_PROVIDER=razorpay` the webhook needs the API reachable publicly (the frontend proxy does not forward `X-Razorpay-Signature`).
- `TRUSTED_PROXY_HOPS`: Google's front end appends one `X-Forwarded-For` entry before the frontend, and the frontend forwards the header unchanged (it never adds to it), so start from `1` and add one per extra load balancer you put in front. Keep the API's ingress internal so nothing reaches it without passing that front end. Check an audit entry's IP after the first deploy.
- Cloud SQL: connect through the Cloud SQL connector or private IP; the owner user runs the Job, `ros_runtime` runs the API. Keep `DATABASE_POOL_MAX` × max instances below the instance's connection limit.
- SSE (`/api/v1/branches/:id/events`) streams through the ops/console proxy: raise the request timeout of the API and the frontends (for example 3600 s); clients reconnect and poll anyway.
- Secrets (`APP_SECRET`, `CRON_SECRET`, database passwords, `RAZORPAY_*`, `S3_SECRET_ACCESS_KEY`) come from Secret Manager; no value is baked into an image, and frontends have no `NEXT_PUBLIC_` configuration.
- Uploads: a GCS bucket through the S3 interoperability endpoint (`S3_ENDPOINT=https://storage.googleapis.com`, HMAC keys), or any other S3-compatible store.
- Rollback is `gcloud run services update-traffic <service> --to-revisions=<previous>=100`, per app (see [rollback](runbooks/rollback.md)).

## Razorpay setup

Online subscription payments are off until `PAYMENT_PROVIDER=razorpay` is set. Until then the Subscription page offers the manual upgrade request only, and a Super Admin activates plans by hand. Prepaid periods use Razorpay **Orders** plus Standard Checkout: one order per period, activated once the payment is captured. Automatic recurring renewal (Razorpay Subscriptions) is not part of this.

1. **Keys.** In the Razorpay dashboard open _Account & Settings → API Keys_. Generate **test mode** keys first (`rzp_test_...`); switch to live keys only after the end-to-end check below. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the server environment (never in the client or in git).
2. **Webhook.** _Account & Settings → Webhooks → Add new webhook_:
   - URL: `https://<public API host>/api/v1/webhooks/razorpay`, on the API itself, not through a frontend (the frontend proxy drops the `X-Razorpay-Signature` header). The route needs no cookie and is exempt from the same-origin check and maintenance mode.
   - Secret: choose a long random string and put the same value in `RAZORPAY_WEBHOOK_SECRET`.
   - Active events: `order.paid` and `payment.captured`. Other events are acknowledged and ignored.
     Webhooks are configured per mode: create one with the test keys and again when going live.
3. Set `PAYMENT_PROVIDER=razorpay` and restart. Startup fails if any of the three variables is missing.
4. **Test-mode check.** Sign in as an organization owner, open _Subscription → Upgrade_, choose a plan and billing cycle and press **Pay with Razorpay**. Pay with a Razorpay test card (for example `4111 1111 1111 1111`, any future expiry, any CVV; for a failing card use `4000 0000 0000 0002` or the "Failure" option in test Checkout). The plan is activated by the verify call that follows a successful payment, or by the webhook — whichever arrives first; the other is a no-op. Confirm the Subscription page shows the plan ACTIVE with the new period end, the history shows "Payment received", and the audit log holds `subscription.paid`. In the dashboard's _Webhooks_ page, every delivery should show 2xx; a 401 means the webhook secret differs between the dashboard and `RAZORPAY_WEBHOOK_SECRET`.
5. **Amounts.** The price charged is always the plan's `monthlyPrice` / `annualPrice` from the database (minor units, INR), never a client value. A payment whose amount differs from the stored order is never activated; it is audited as `payment.amount_mismatch` for a Super Admin to settle by hand.

## Backups and recovery

See [backup and restore](runbooks/backup-and-restore.md) for the exact commands. In short:

- Nightly logical backup: `pnpm db:dump --out backup-$(date +%F).dump` (custom format, plus a manifest of per-table row counts), stored in a separate account or bucket, 30 days retention. It is provider-neutral and restores into any PostgreSQL 18.
- Restore drill monthly into an empty database with `pnpm db:restore` and `pnpm db:verify`, then start the API against it.
- Uploaded files: bucket versioning (or back up `STORAGE_LOCAL_DIR`).
- Managed point-in-time recovery, where available, is the faster path for "undo the last hour".

### Restoring as a different user

`pnpm db:restore` does not require the restoring user to be the dump's owner (for example a PGlite dump owned by `postgres` restored into a managed Postgres as `ros_owner`). Objects are re-owned by the restoring user (`--no-owner`), and the dump's own `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` entries are replayed without `FOR ROLE`, so later migrations run by that user still hand the tenant roles their grants. Grants and row-level security policies come from the dump, never from re-applied migration files. The restoring user needs `CREATEROLE` on a cluster without `ros_tenant`/`ros_runtime` (it creates them and so holds the ADMIN option); if the roles already exist, it needs the ADMIN option on `ros_tenant` or the memberships granted by an admin beforehand (`GRANT ros_tenant TO ros_runtime; GRANT ros_tenant TO <user>;`), otherwise the restore refuses with exit 3 before writing anything. Pair the restore with a client of the server's major version (`PG_DOCKER_CONTAINER=<postgres:18 container>` runs `pg_restore`/`psql` from the server's image).

## Data retention

Expired or suspended workspaces keep their data (read-only or blocked). Nothing is deleted automatically. Deleting a workspace on request is a manual, audited operation; disclose retention in the Privacy Policy (the legal pages are templates to be reviewed by a lawyer).

## Before going live (not done yet)

Provisioning scripts for the cloud target (`infra/gcp/` in the design is not written), error monitoring (Sentry adapter), Web Push, the full Playwright workflow suite, a load test, and a review of the legal templates. Row-level security, S3 storage, multi-instance realtime and per-app images are implemented.
