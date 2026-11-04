# Provider Migration Guide

How to replace each provider without touching business logic. In every case: implement the port, wire it in `src/server/container.ts`, add the env vars to `src/server/config/env.ts` and `docs/environment-variables.md`, run the integration suite (`pnpm test`), then switch the env var in the target environment.

## Database (PostgreSQL host)

The app speaks standard PostgreSQL 16 (FKs, partial unique indexes, `gen_random_uuid()`, `FOR UPDATE`). Moving between Postgres hosts (local → Neon → Supabase → RDS/Cloud SQL/Aiven) is **configuration only**:

1. Create the database; get a connection string with TLS (`?sslmode=require`).
2. `DATABASE_URL=<new> pnpm db:migrate` (applies `src/infrastructure/database/providers/postgres/migrations/*` and syncs roles/permissions/plans).
3. Copy data: `pg_dump --no-owner --format=custom $OLD | pg_restore --no-owner -d $NEW`.
4. Point `DATABASE_URL` at the new host; restart. Verify with the smoke checks in `deployment.md`.

Serverless hosts with connection limits: keep `DATABASE_POOL_MAX` low (e.g. 5) or use the provider's pooled endpoint.

**Changing to a non-Postgres database** (e.g. MySQL, MongoDB) is a larger but contained change:
- Files to replace: `src/infrastructure/database/providers/postgres/**` (schema, migrations, `client.ts`, `repositories/*.ts`, `system-data.ts`).
- Files to update: `src/server/container.ts` and `src/server/composition/*.ts` (import the new repository factories).
- Unchanged: `src/domain/**`, `src/server/modules/**`, `src/server/authz/**`, `src/contracts/**`, all UI.
- Tests: the integration suite in `tests/integration/` must pass against the new adapters (adapt `src/test/harness.ts` to start the new database).
- Guarantees to re-implement: unique constraints listed in `database-schema.md` (one open session per table, one live bill per session, one active QR per table, idempotency keys), conditional version updates, transactions.

## Identity (auth)

Current: `local` adapter (`src/infrastructure/auth/providers/local-identity.ts`).
To move to Clerk / Auth0 / Supabase Auth / Better Auth:
1. Implement `IdentityProvider` in `src/infrastructure/auth/providers/<name>.ts`: `resolveSession` validates the provider's session/JWT and maps the provider subject to `users.id` (add a `user_identities(provider, subject, user_id)` table via a new migration).
2. Replace sign-up/sign-in UI with the provider's flow, or keep ours and call the provider API from `src/server/auth/auth-service.ts`.
3. Wire in `container.ts`. Workspaces, memberships, roles and permissions do not change.
4. Tests to update: `tests/integration/auth-and-workspaces.test.ts`.
Migrating existing users: export emails; send password-reset invitations from the new provider (scrypt hashes are not portable to most hosted providers).

## Object storage

Current: `local` filesystem (`.data/uploads`). Production needs shared storage (multiple instances, ephemeral disks).
To use Cloudflare R2 / Backblaze B2 / AWS S3 / MinIO (all S3-compatible):
1. `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` (requires approval of the new dependency).
2. Create `src/infrastructure/storage/providers/s3-storage.ts` implementing `ObjectStorage` (`PutObject`, `GetObject`, `DeleteObject`; `url()` = public bucket/CDN URL or presigned GET).
3. In `container.ts` `selectStorage`, return it when `STORAGE_PROVIDER=s3` using `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (already declared in env).
4. Copy existing objects: `rclone copy .data/uploads s3:<bucket>` (keys are identical; drop the `.meta.json` sidecars and set Content-Type on upload).
5. Tests: menu upload integration tests.

## Realtime

Current: in-process memory bus + SSE (`/api/v1/branches/:id/events`), clients also poll. Works on a single Node instance.
Before running more than one instance (or on serverless):
- **Postgres LISTEN/NOTIFY** adapter (no new vendor): `publish` → `pg_notify('realtime', json)`; each instance `LISTEN`s and fans out to its SSE subscribers. Implement `RealtimeBus` in `src/infrastructure/realtime/providers/pg-notify.ts`.
- **Ably / Pusher**: implement `RealtimePublisher` with their REST publish; clients subscribe with tokens issued by a new authorized endpoint (per-branch channel capability after `c.access.forBranch`). Replace `src/features/realtime/use-branch-events.ts` transport.
No data migration; clients keep polling during the switch.

## Email

Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` (needs a verified domain) or `EMAIL_PROVIDER=brevo` + `BREVO_API_KEY`, and `EMAIL_FROM`. Other providers: implement `EmailSender` (HTTP API, no SDK needed) in `src/infrastructure/email/providers/` and add a branch in `selectEmail`. Outbox history stays in `email_outbox`.

## Push notifications

Current: disabled (`none`). To enable Web Push:
1. Generate VAPID keys (`npx web-push generate-vapid-keys`), set `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:...`.
2. `pnpm add web-push` (approval required) and implement `PushSender` in `src/infrastructure/push/providers/web-push.ts`; wire in `container.ts`.
3. The subscription API and UI already store `push_subscriptions`; the service worker needs a `push` event handler.

## Logging and error monitoring

Logs are JSON lines on stdout/stderr — any log drain (Better Stack, Grafana Loki, host logs) ingests them unchanged. For Sentry: implement `ErrorReporter` with `@sentry/nextjs` (dependency approval required) and select it with `ERROR_REPORTER=sentry`.

## Hosting

The app is a standard `next build && next start` Node server (no host-specific APIs). Moving hosts = deploy the same build with the same env vars. Constraints: the memory realtime bus needs a single long-running instance; local storage needs a persistent disk (use S3 storage otherwise).

## Scheduled jobs

Any scheduler that can send `POST /api/v1/jobs/subscriptions` with `Authorization: Bearer $CRON_SECRET` works. Jobs are idempotent and only send reminders; access is computed from dates at request time, so a missed run never grants or removes access.
