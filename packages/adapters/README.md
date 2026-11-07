# @ros/adapters

Every adapter that talks to an external provider lives here (the database adapter lives in `@ros/database`).

```
src/<capability>/
  interfaces/   provider-neutral contracts (TypeScript interfaces + types)
  providers/    one file per concrete provider, implementing the interfaces
```

Capabilities: `auth` (local identity), `email` (outbox, Resend, Brevo), `storage` (local, S3), `realtime` (memory, Postgres `LISTEN/NOTIFY`), `payments` (Razorpay, a test fake), `push` (no-op), `logging` (JSON console logger).

## Rules

1. Only `apps/api/src/composition/container.ts` imports `providers/*` and chooses one per capability from the environment. `@ros/application` depends on `interfaces/*` only; the frontends never import this package (ESLint enforces both).
2. Provider SDKs (AWS SDK, `pg`, …) are imported only inside `providers/`.
3. Interfaces use our own types. They never return provider response objects, provider error classes or provider-specific URLs. Storage returns object keys; URLs come from `ObjectStorage.url()`.
4. A capability with several providers has a shared contract suite each one must pass (`storage/object-storage.contract.ts`). That's how a provider swap is verified.
5. This package may import `@ros/application` for types only and does not depend on it, so the build graph stays acyclic.

See `docs/provider-abstractions.md` and `docs/provider-migration-guide.md`.
