# Provider Abstractions

Every infrastructure capability that could realistically be replaced sits behind a small interface (port). Business logic in `@ros/application` depends only on the port. Concrete adapters live in `packages/adapters/src/<capability>/providers/` (and `packages/database/src/providers/postgres/` for the database) and are chosen in **one** place: `apps/api/src/composition/container.ts` (`selectEmail`, `selectStorage`, `selectRealtime`, `selectPaymentGateway`), plus per-module repository wiring in `apps/api/src/composition/*.ts`. The frontends never import an adapter (ESLint `FRONTEND_BOUNDARY`).

Not abstracted on purpose: Next.js, React, Zod, Drizzle's query builder _inside_ the database package. Those are frameworks, not providers.

| Capability              | Port (interface)                                                                                                                               | File                                                              | Adapters today                                                                                               | Selected by                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Database / transactions | `TransactionRunner<R>` + per-module repository interfaces (`application/src/modules/*/ports.ts`, `application/src/ports/core-repositories.ts`) | `packages/database/src/interfaces/transaction.ts`                 | Postgres via Drizzle: `node-postgres` (runtime), PGlite (tests, zero-install dev); tenant and system runners | `DATABASE_PROVIDER`, `DATABASE_URL`, `DATABASE_TENANT_ROLE` |
| Identity / sessions     | `IdentityProvider`                                                                                                                             | `packages/adapters/src/auth/interfaces/identity-provider.ts`      | `local` (scrypt passwords, opaque hashed session tokens in Postgres)                                         | built in the container                                      |
| Object storage          | `ObjectStorage` (`put/get/delete/url`)                                                                                                         | `packages/adapters/src/storage/interfaces/object-storage.ts`      | `local` filesystem (served by `/api/v1/files/*`), `s3` (any S3-compatible store)                             | `STORAGE_PROVIDER`, `S3_*`                                  |
| Realtime                | `RealtimePublisher`, `RealtimeSubscriber` (`RealtimeBus`)                                                                                      | `packages/adapters/src/realtime/interfaces/realtime.ts`           | `memory` (in-process), `postgres` (`LISTEN/NOTIFY`), `none`; delivered to browsers over SSE                  | `REALTIME_PROVIDER`                                         |
| Email                   | `EmailSender`                                                                                                                                  | `packages/adapters/src/email/interfaces/email-sender.ts`          | `outbox` (dev sink), `resend`, `brevo` (HTTP APIs, no SDK)                                                   | `EMAIL_PROVIDER` + API key                                  |
| Payments                | `PaymentGateway` (`createOrder`, `fetchOrderPayments`, `verifyPaymentSignature`, `verifyWebhookSignature`)                                     | `packages/application/src/ports/payment-gateway.ts`               | `razorpay` (Orders API + Standard Checkout, plain `fetch`); a fake for tests; none = manual upgrade requests | `PAYMENT_PROVIDER`, `RAZORPAY_*`                            |
| Push                    | `PushSender`                                                                                                                                   | `packages/adapters/src/push/interfaces/push-sender.ts`            | `none` (no-op)                                                                                               | `PUSH_PROVIDER`                                             |
| Logging                 | `Logger`                                                                                                                                       | `packages/application/src/ports/observability.ts`                 | JSON lines to stdout/stderr with secret redaction (`packages/adapters/src/logging`)                          | `LOG_LEVEL`                                                 |
| Error reporting         | `ErrorReporter`                                                                                                                                | `packages/application/src/ports/observability.ts`                 | `log` (writes to the logger), `none`                                                                         | `ERROR_REPORTER`                                            |
| Clock                   | `Clock` / `AdjustableClock`                                                                                                                    | `packages/application/src/ports/observability.ts`, `container.ts` | system clock with a test-only offset                                                                         | `ENABLE_TEST_HOOKS`                                         |
| Background jobs         | HTTP endpoint `/api/v1/jobs/*` with `CRON_SECRET`                                                                                              | platform module                                                   | any scheduler that can POST (Cloud Scheduler, GitHub Actions, host cron)                                     | `CRON_SECRET`                                               |
| API transport (web)     | `/api/v1/*` proxy in each frontend                                                                                                             | `packages/web-core/src/api-proxy.ts`                              | `fetch` to `API_INTERNAL_URL`, streamed both ways                                                            | `API_INTERNAL_URL`                                          |

## Contracts each adapter must honour

**Repositories / `TransactionRunner`**

- `run()` is atomic (all-or-nothing). In the tenant runner `read()` is a transaction too, because the role switch and the RLS settings are transaction-local.
- Unique-constraint violations surface as `UniqueViolationError` (never a driver error).
- Repositories return domain/DTO types — never driver rows, never ORM objects.
- Every tenant method takes `workspaceId` (and `branchId` where relevant) from a server-resolved scope.
- The tenant runner must fail closed without a bound request context (`TenantContextError`).

**IdentityProvider**

- `resolveSession` returns `null` (never throws) for unknown, revoked or expired tokens.
- Tokens are opaque to callers; only hashes may be persisted.
- `revokeAllSessions` must take effect on the next request.

**ObjectStorage**

- Keys are opaque, validated (`OBJECT_KEY` in `@ros/contracts/menu`) and stored in the DB; URLs are always derived via `url(key)`.
- `get` returns `null` for missing objects.
- `packages/adapters/src/storage/object-storage.contract.ts` is the shared contract suite; the local adapter runs it in every test run, the S3 adapter against MinIO in CI.

**RealtimeBus**

- Best-effort, at-most-once delivery. Messages carry ids only; clients refetch through authorized APIs and always poll as well.
- A broken listener must not affect publishers or other listeners. Adapters holding connections release them in `close()`.
- The Postgres bus caps payloads below the 8000-byte `NOTIFY` limit.

**EmailSender**

- `delivers=false` marks a sink; every message is still recorded in `email_outbox`.
- Errors must not include recipient data in their message.

**PaymentGateway**

- Amounts are minor units; the charged amount always comes from the plan stored in the database, never from the client.
- Signature checks are constant-time HMAC-SHA256; the module never sees a secret.

**PushSender**

- `send` returns `gone` for expired subscriptions so the caller can delete them.

See `provider-migration-guide.md` for exact replacement steps.
