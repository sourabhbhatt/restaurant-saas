# Environment Variables

Validated at startup by `src/server/config/env.ts` (Zod). Invalid configuration fails fast with a list of problems. Copy `.env.example` to `.env.local` for development. Never commit real values.

| Variable | Default | Required in prod | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | set by host | `production` enables strict checks below |
| `APP_URL` | `http://localhost:3000` | **yes** | Public origin; used for links in emails, QR URLs and the CSRF origin check |
| `APP_NAME` | `RestaurantOS` | no | Product name in emails |
| `DATABASE_PROVIDER` | `postgres` | no | `postgres` or `pglite` (embedded, dev/test only) |
| `DATABASE_URL` | local dev URL | **yes** | Postgres connection string (use TLS in prod) |
| `DATABASE_POOL_MAX` | `10` | no | Pool size; lower on serverless Postgres |
| `PGLITE_DATA_DIR` | — | no | Persist PGlite to disk; empty = in-memory |
| `APP_SECRET` | dev placeholder | **yes (≥32 chars)** | Derives the QR token encryption key. Rotating it makes stored QR codes un-downloadable (regenerate them) |
| `SESSION_TTL_DAYS` | `30` | no | Sliding session lifetime |
| `COOKIE_SECURE` | auto (https → true) | no | Force the `Secure` cookie flag |
| `EMAIL_PROVIDER` | `outbox` | no | `outbox` (no delivery, dev mailbox), `resend`, `brevo` |
| `EMAIL_FROM` | `RestaurantOS <no-reply@restaurantos.local>` | if delivering | Sender |
| `RESEND_API_KEY` / `BREVO_API_KEY` | — | with that provider | API keys |
| `STORAGE_PROVIDER` | `local` | no | `local`; `s3` requires the S3 adapter (see migration guide) |
| `STORAGE_LOCAL_DIR` | `.data/uploads` | no | Local storage directory (must be persistent) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | with s3 | S3-compatible storage |
| `REALTIME_PROVIDER` | `memory` | no | `memory` (single instance SSE) or `none` (polling only) |
| `PUSH_PROVIDER` | `none` | no | `webpush` requires the adapter + VAPID keys |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | with webpush | Web Push |
| `LOG_LEVEL` | `info` | no | `debug`/`info`/`warn`/`error` |
| `ERROR_REPORTER` | `log` | no | `log` or `none` |
| `CRON_SECRET` | — | for jobs | Bearer secret for `/api/v1/jobs/*` (≥16 chars) |
| `ENABLE_TEST_HOOKS` | `false` | **must be false** | Enables test clock + dev mailbox; startup fails if true in production |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | — | for seeding | First Super Admin created by `pnpm db:seed` |
