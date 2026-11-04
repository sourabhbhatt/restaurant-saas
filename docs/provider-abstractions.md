# Provider Abstractions

Every infrastructure capability that could realistically be replaced sits behind a small interface (port). Business logic depends only on the port. Concrete adapters live in `src/infrastructure/<capability>/providers/` and are chosen in **one** place: `src/server/container.ts` (plus per-module repository wiring in `src/server/composition/*.ts`).

Not abstracted on purpose: Next.js, React, Zod, Drizzle's query builder _inside_ adapters. Those are frameworks, not providers.

| Capability              | Port (interface)                                                                                                             | File                                                      | Adapters today                                                                     | Selected by                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| Database / transactions | `TransactionRunner<R>` + per-module repository interfaces (`server/modules/*/ports.ts`, `server/ports/core-repositories.ts`) | `src/infrastructure/database/interfaces/transaction.ts`   | Postgres via Drizzle: `node-postgres` (runtime), PGlite (tests / zero-install dev) | `DATABASE_PROVIDER`, `DATABASE_URL` |
| Identity / sessions     | `IdentityProvider`                                                                                                           | `src/infrastructure/auth/interfaces/identity-provider.ts` | `local` (scrypt passwords, opaque hashed session tokens in Postgres)               | built in container                  |
| Object storage          | `ObjectStorage` (`put/get/delete/url`)                                                                                       | `src/infrastructure/storage/interfaces/object-storage.ts` | `local` filesystem (served by `/api/v1/files/*`)                                   | `STORAGE_PROVIDER`                  |
| Realtime                | `RealtimePublisher`, `RealtimeSubscriber` (`RealtimeBus`)                                                                    | `src/infrastructure/realtime/interfaces/realtime.ts`      | in-process `memory` bus → SSE; `none`                                              | `REALTIME_PROVIDER`                 |
| Email                   | `EmailSender`                                                                                                                | `src/infrastructure/email/interfaces/email-sender.ts`     | `outbox` (dev sink), `resend`, `brevo` (HTTP APIs, no SDK)                         | `EMAIL_PROVIDER` + API key          |
| Push                    | `PushSender`                                                                                                                 | `src/infrastructure/push/interfaces/push-sender.ts`       | `none` (no-op)                                                                     | `PUSH_PROVIDER`                     |
| Logging                 | `Logger`                                                                                                                     | `src/server/ports/observability.ts`                       | JSON lines to stdout/stderr with secret redaction                                  | `LOG_LEVEL`                         |
| Error reporting         | `ErrorReporter`                                                                                                              | `src/server/ports/observability.ts`                       | `log` (writes to logger), `none`                                                   | `ERROR_REPORTER`                    |
| Clock                   | `Clock` / `AdjustableClock`                                                                                                  | `src/server/container.ts`                                 | system clock with test-only offset                                                 | `ENABLE_TEST_HOOKS`                 |
| Background jobs         | HTTP endpoint `/api/v1/jobs/*` with `CRON_SECRET`                                                                            | platform module                                           | any scheduler that can POST (cron-job.org, GitHub Actions, host cron)              | `CRON_SECRET`                       |

## Contracts each adapter must honour

**Repositories / `TransactionRunner`**

- `run()` is atomic (all-or-nothing); `read()` is not transactional.
- Unique-constraint violations surface as `UniqueViolationError` (never a driver error).
- Repositories return domain/DTO types — never driver rows, never ORM objects.
- Every tenant method takes `workspaceId` (and `branchId` where relevant) from a server-resolved scope.

**IdentityProvider**

- `resolveSession` returns `null` (never throws) for unknown, revoked or expired tokens.
- Tokens are opaque to callers; only hashes may be persisted.
- `revokeAllSessions` must take effect on the next request.

**ObjectStorage**

- Keys are opaque, validated, and stored in the DB; URLs are always derived via `url(key)`.
- `get` returns `null` for missing objects.

**RealtimeBus**

- Best-effort, at-most-once delivery. Messages carry ids only; clients refetch through authorized APIs. Clients always also poll.

**EmailSender**

- `delivers=false` marks a sink; every message is still recorded in `email_outbox`.
- Errors must not include recipient data in their message.

**PushSender**

- `send` returns `gone` for expired subscriptions so the caller can delete them.

See `provider-migration-guide.md` for exact replacement steps.
