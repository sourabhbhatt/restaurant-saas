# Provider Migration Guide

How to replace each provider without touching business logic. In every case: implement the port in `packages/adapters/src/<capability>/providers/`, select it in `apps/api/src/composition/container.ts`, add the env vars to `packages/application/src/config/env.ts` and `docs/environment-variables.md`, run the tests (`pnpm test`), then switch the env var in the target environment. Only the API image changes; the frontends never load adapters.

## Database (PostgreSQL host)

The app speaks standard PostgreSQL 18 (FKs, partial unique indexes, `gen_random_uuid()`, `FOR UPDATE`, row-level security, `LISTEN/NOTIFY` for the Postgres realtime bus). Use the same major version as the source: a `pg_dump` is not guaranteed to restore into an older major. Moving between Postgres hosts (local → Cloud SQL → Neon/Supabase/RDS/Aiven/a VPS) is **configuration only**:

1. Create an empty database and an owner user that can `CREATEROLE` (or have an admin create `ros_tenant` / `ros_runtime` first, see [restoring as a different user](deployment.md#restoring-as-a-different-user)). Get a connection string with TLS (`?sslmode=require`).
2. Dump the source: `pnpm db:dump --out backup.dump` (writes `backup.dump.manifest.json` with per-table row counts).
3. Restore into the empty target: `pnpm db:restore --in backup.dump --target-url <new owner URL>`. It refuses a non-empty target (exit 2) and runs in one transaction.
4. `DATABASE_URL=<new owner URL> pnpm db:migrate` (applies pending files from `packages/database/src/providers/postgres/migrations/` and syncs system data), then `pnpm db:verify --manifest backup.dump.manifest.json --target-url <new owner URL>`.
5. Give `ros_runtime` a login (`ALTER ROLE ros_runtime LOGIN PASSWORD '…'; GRANT CONNECT ON DATABASE <db> TO ros_runtime;`), point the API's `DATABASE_URL` at it and restart. Run `pnpm smoke --base-url <console URL>`.

The runbook [backup and restore](runbooks/backup-and-restore.md) has the full command list.

Serverless hosts with connection limits: keep `DATABASE_POOL_MAX` low (e.g. 5) or use the provider's pooled endpoint.

**Changing to a non-Postgres database** (e.g. MySQL, MongoDB) is a larger but contained change:

- Files to replace: `packages/database/src/providers/postgres/**` (schema, migrations, `client.ts` runners, `repositories/*.ts`, `system-data.ts`).
- Files to update: `apps/api/src/composition/*.ts` (import the new repository factories and runners).
- Unchanged: `packages/domain`, `packages/application`, `packages/contracts`, all frontends.
- Tests: the integration suite in `apps/api/tests/integration/` must pass against the new adapters (adapt `apps/api/src/test/harness.ts` to start the new database).
- Row-level security has no equivalent in most other databases; the application-layer scoping stays the primary control.
- Guarantees to re-implement: unique constraints listed in `database-schema.md` (one open session per table, one live bill per session, one active QR per table, idempotency keys), conditional version updates, transactions.

## Identity (auth)

Current: `local` adapter (`packages/adapters/src/auth/providers/local-identity.ts`).
To move to Clerk / Auth0 / Supabase Auth / Better Auth:

1. Implement `IdentityProvider` in `packages/adapters/src/auth/providers/<name>.ts`: `resolveSession` validates the provider's session/JWT and maps the provider subject to `users.id` (add a `user_identities(provider, subject, user_id)` table via a new migration).
2. Replace sign-up/sign-in UI with the provider's flow, or keep ours and call the provider API from `packages/application/src/auth/auth-service.ts`.
3. Wire in `container.ts`. Workspaces, memberships, roles and permissions do not change.
4. Tests to update: `apps/api/tests/integration/auth-and-workspaces.test.ts`.
   Migrating existing users: export emails; send password-reset invitations from the new provider (scrypt hashes are not portable to most hosted providers).

## Object storage

Current: `local` filesystem (`STORAGE_LOCAL_DIR`) and `s3` (`packages/adapters/src/storage/providers/s3-storage.ts`, AWS SDK v3), which targets any S3-compatible API (AWS S3, Cloudflare R2, Backblaze B2, MinIO; Google Cloud Storage through its S3 interoperability endpoint and HMAC keys). Only MinIO is exercised by the tests. Production needs `s3` (several instances, ephemeral disks).

1. Create the bucket (the adapter never creates it) and an access key limited to it.
2. Set `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and for non-AWS stores `S3_ENDPOINT` (plus `S3_FORCE_PATH_STYLE=true` for MinIO). Startup fails if one is missing.
3. Copy existing objects: `rclone copy <STORAGE_LOCAL_DIR> <remote>:<bucket>` (keys are identical; drop the `.meta.json` sidecars and set Content-Type on upload).
4. Tests: the shared contract (`object-storage.contract.ts`) runs against MinIO with `S3_TEST_ENDPOINT` set; the menu upload integration tests run on local storage.

Another store: implement `ObjectStorage`, run the contract suite against it, add a branch in `selectStorage`.

## Realtime

Current: `memory` (one API process), `postgres` (`packages/adapters/src/realtime/providers/postgres-bus.ts`: `pg_notify` on publish, one `LISTEN` connection per API instance fanning out to its SSE subscribers) and `none`. Use `postgres` as soon as more than one API instance runs (compose and any autoscaled host). No data migration; clients keep polling during the switch.

For a hosted service (Ably, Pusher): implement `RealtimePublisher` with their REST publish; clients subscribe with tokens issued by a new authorized endpoint (per-branch channel capability after `c.access.forBranch`), and `packages/web-core/src/features/realtime/use-branch-events.ts` changes transport.

## Email

Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` (needs a verified domain) or `EMAIL_PROVIDER=brevo` + `BREVO_API_KEY`, and `EMAIL_FROM`. Other providers: implement `EmailSender` (HTTP API, no SDK needed) in `packages/adapters/src/email/providers/` and add a branch in `selectEmail`. Outbox history stays in `email_outbox`.

## Push notifications

Current: disabled (`none`). To enable Web Push:

1. Generate VAPID keys (`npx web-push generate-vapid-keys`), set `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:...`.
2. `pnpm --filter @ros/adapters add web-push` (approval required), implement `PushSender` in `packages/adapters/src/push/providers/web-push.ts`, add `webpush` handling in `apps/api/src/composition/container.ts`.
3. The subscription API and UI already store `push_subscriptions`, and both service workers (`apps/console/src/app/sw.ts`, `apps/ops/src/app/sw.ts`) already handle `push` and `notificationclick`.

## Logging and error monitoring

Logs are JSON lines on stdout/stderr — any log drain (Better Stack, Grafana Loki, host logs) ingests them unchanged. For Sentry: implement `ErrorReporter` with `@sentry/nextjs` (dependency approval required) and select it with `ERROR_REPORTER=sentry`.

## Payments

Current: `razorpay` (`packages/adapters/src/payments/providers/razorpay.ts`) or none. Another gateway (Stripe, Cashfree, PayU): implement `PaymentGateway` (`packages/application/src/ports/payment-gateway.ts`), add a value to `PAYMENT_PROVIDER` and its keys to the env schema, select it in `selectPaymentGateway`, add its webhook route under `apps/api/src/app/api/v1/webhooks/`. `payment_orders` and `payment_events` are provider-tagged (`provider` column), so history from the old gateway stays readable. Tests: `payments-razorpay.test.ts` shows the shape, using the fake gateway.

## Hosting

Each app is a standalone Next.js server (`output: "standalone"`) in its own image built by `infra/docker/next-app.Dockerfile`; no host-specific APIs are used. Moving hosts = run the same images with the same env vars (Cloud Run, any container host, or the compose stack on a VPS). Constraints: `REALTIME_PROVIDER=memory` needs a single API instance; local storage needs a persistent disk (use `s3` otherwise); SSE needs request timeouts of several minutes on the frontends and the API.

## Scheduled jobs

Any scheduler that can send `POST <API URL>/api/v1/jobs/subscriptions` with `Authorization: Bearer $CRON_SECRET` to the API (not through a frontend, whose proxy drops `Authorization`) works. Jobs are idempotent and only send reminders; access is computed from dates at request time, so a missed run never grants or removes access.
