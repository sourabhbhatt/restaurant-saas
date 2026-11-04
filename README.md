# RestaurantOS

Multi-tenant restaurant SaaS: workspaces with multiple restaurants and branches, QR dine-in ordering (no customer app or account), waiter approval, kitchen display, counter billing with partial payments, trials and subscriptions, Super Admin console, offline-tolerant staff devices.

**Status:** server side is complete and verified by 349 automated tests plus a live order-to-payment run. Several UI screens have not been checked in a browser yet. See [docs/implementation-roadmap.md](docs/implementation-roadmap.md) for exactly what is done and what is not.

## Quick start (local)

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local
```

Pick a database in `.env.local`:

- **Zero install:** `DATABASE_PROVIDER=pglite` and `PGLITE_DATA_DIR=.data/pglite` (embedded Postgres; one process at a time, so stop `pnpm dev` before running `db:*` scripts).
- **Real Postgres 16:** keep `DATABASE_PROVIDER=postgres` and create the role and database from `DATABASE_URL`.

```bash
pnpm db:migrate     # schema + roles, permissions, default plans
pnpm db:seed        # demo data and logins (development only)
pnpm dev            # http://localhost:3000
```

Demo logins after `db:seed`: `owner@demo.local` / `Demo-Owner-2026`; `manager|waiter|kitchen|cashier@demo.local` / `Demo-Staff-2026`; `admin@restaurantos.local` / `ChangeMe-Admin-2026` (Super Admin). The seed prints sample customer QR links. Or sign up at `/sign-up` and follow onboarding. Emails are not delivered in development; read them at `/dev/mailbox`.

Make an existing account a Super Admin: `pnpm db:make-admin you@example.com`.

## Scripts

| Script                                                          | Purpose                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                                  | Next.js dev server / production build / serve                                    |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`              | Static checks                                                                    |
| `pnpm test`                                                     | Vitest: domain unit tests, UI unit tests, integration tests on embedded Postgres |
| `pnpm test:e2e`                                                 | Playwright (public site specs)                                                   |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:make-admin` | Database tooling                                                                 |

## Where things live

```
src/domain/          pure business rules (pricing, orders, billing, entitlements, permissions)
src/contracts/       Zod schemas + DTOs shared by API and UI
src/server/          application services, authorization, HTTP wrapper, composition root
src/infrastructure/  all provider adapters (database, auth, email, storage, realtime, push, logging)
src/features/        UI per feature      src/components/  design system and layouts
src/app/             routes: /, (auth), /app, /waiter, /kitchen, /cashier, /t/<qr>, /admin, /api/v1
tests/integration/   API-level tests on a real (embedded) Postgres
```

## Documentation

[architecture](docs/architecture.md) · [API reference](docs/api-reference.md) · [technology decisions](docs/technology-decisions.md) · [provider abstractions](docs/provider-abstractions.md) · [provider migration](docs/provider-migration-guide.md) · [database schema](docs/database-schema.md) · [tenant security](docs/tenant-security.md) · [offline sync](docs/offline-sync.md) · [environment variables](docs/environment-variables.md) · [deployment](docs/deployment.md) · [testing](docs/testing.md) · [roadmap](docs/implementation-roadmap.md)

This repo uses a Next.js version with breaking changes; read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).
