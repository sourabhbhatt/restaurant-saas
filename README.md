# RestaurantOS

Multi-tenant restaurant SaaS: organizations that own workspaces with multiple restaurants and branches, QR dine-in ordering (no customer app or account), waiter approval, kitchen display, counter billing with partial payments, trials and prepaid subscriptions (manual approval or Razorpay), Super Admin console, offline-tolerant staff devices.

The code is a pnpm + Turborepo monorepo with four independently deployable Next.js 16 apps and ten internal packages. See [docs/architecture.md](docs/architecture.md) for the layout and [docs/implementation-roadmap.md](docs/implementation-roadmap.md) for what is done and what is not.

| App            | Port | Serves                                                                                               |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `apps/api`     | 4000 | REST API `/api/v1/*` (the only app that talks to the database, storage, email and payment providers) |
| `apps/console` | 3000 | Public site, sign-up/sign-in, onboarding, workspace and branch management, customer QR pages `/t/*`  |
| `apps/ops`     | 3001 | Staff consoles: `/waiter`, `/kitchen`, `/cashier` (PWA, offline outbox)                              |
| `apps/admin`   | 3002 | Super Admin console `/admin` (no PWA, `noindex`)                                                     |

The three frontends never reach the database. Each one forwards `/api/v1/*` to the API at request time (`API_INTERNAL_URL`), so the session cookie stays first-party on every origin. Each origin has its own session: sign in separately on ops and admin.

## Quick start (local)

Requires Node 22+ and pnpm 10.28 (`corepack enable`).

```bash
pnpm install
cp .env.example .env.local
```

Edit `.env.local`:

- **Database, zero install:** `DATABASE_PROVIDER=pglite` and `PGLITE_DATA_DIR=/absolute/path/to/repo/.data/pglite` (embedded Postgres 18; one process at a time, so stop `pnpm dev` before running `db:*` scripts).
- **Database, real Postgres 18:** keep `DATABASE_PROVIDER=postgres` and point `DATABASE_URL` at it (for example `docker run -d --name ros-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:18`).
- `TRUSTED_PROXY_HOPS=1`: every browser request reaches the API through a frontend's proxy. (`PROXY_SHARED_SECRET` is only needed where the frontends call the API over a public URL; see the env doc.)
- `ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002`, otherwise writes from ops and admin are rejected as cross-site.
- Use absolute paths for `PGLITE_DATA_DIR` and `STORAGE_LOCAL_DIR`: the root `db:*` scripts run from the repo root, but `next dev` for the API runs in `apps/api`, so a relative path names two different directories.

The API reads its environment from `apps/api/.env.local` (Next.js loads env files from the app's own directory). Link it once:

```bash
ln -s ../../.env.local apps/api/.env.local
```

The frontends need no env file; their defaults point at the local ports. Then:

```bash
pnpm db:migrate     # migrations + system data (permissions, roles, plans, settings); snapshots a persistent PGlite dir first
pnpm db:seed        # demo data and logins (development only)
pnpm dev            # turbo: api :4000, console :3000, ops :3001, admin :3002
```

Run one app with `pnpm --filter @ros/<api|console|ops|admin> dev`.

Demo logins after `db:seed`: `owner@demo.local` / `Demo-Owner-2026`; `manager|waiter|kitchen|cashier@demo.local` / `Demo-Staff-2026`; `admin@restaurantos.local` / `ChangeMe-Admin-2026` (Super Admin). The seed prints sample customer QR links. Or sign up at `http://localhost:3000/sign-up` and follow onboarding. Emails are not delivered in development; read them at `http://localhost:3000/dev/mailbox`.

Make an existing account a Super Admin: `pnpm db:make-admin you@example.com`.

### Environment per app

| App                   | Needs                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api                   | Everything in [environment variables](docs/environment-variables.md#api-appsapi): `DATABASE_*`, `APP_URL` (the console origin), `APP_SECRET`, `ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS`, storage, email, payments, realtime |
| console / ops / admin | `API_INTERNAL_URL` (default `http://localhost:4000`), `CONSOLE_URL`, `OPS_URL`, `ADMIN_URL` (default to the local ports), optional `APP_VERSION`. No `NEXT_PUBLIC_*` values are needed.                                   |

### Full stack in Docker

```bash
cp infra/compose/.env.compose.example infra/compose/.env.compose   # then replace every placeholder
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose up -d --build
```

Postgres 18, MinIO and the four apps, with row-level security on (the API connects as `ros_runtime`). See [deployment](docs/deployment.md#docker-compose).

## Scripts (repo root)

| Script                                                           | Purpose                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                                   | Turborepo across the four apps                                             |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check` | Static checks (`check` adds `pnpm test`)                                   |
| `pnpm test`                                                      | Vitest in every package and app (see [testing](docs/testing.md))           |
| `pnpm test:e2e`                                                  | Playwright; builds and starts the API on :4100 and the console on :3100    |
| `pnpm db:migrate` / `db:seed` / `db:make-admin` / `db:generate`  | Database tooling (`db:generate` runs drizzle-kit in `packages/database`)   |
| `pnpm db:snapshot` / `db:dump` / `db:restore` / `db:verify`      | Backups and restores (see [runbooks](docs/runbooks/backup-and-restore.md)) |
| `pnpm db:revoke-cookie-jar`                                      | Revoke the sessions whose tokens are in an exported cookie jar             |
| `pnpm smoke --base-url <url>`                                    | HTTP order-to-payment smoke run against any deployment                     |

## Where things live

```
apps/api/            REST API routes, composition root (provider selection), seed script, integration tests
apps/console/        console routes and console-only features (menu, tables, branches, members, customer QR)
apps/ops/            waiter / kitchen / cashier routes and features, service worker
apps/admin/          Super Admin routes
packages/domain/     pure business rules (pricing, orders, billing, entitlements, permissions)
packages/contracts/  Zod schemas + DTOs shared by API and UI
packages/application/ use cases, authorization, HTTP wrapper, ports (no provider code)
packages/adapters/   identity, email, storage (local, S3), realtime (memory, Postgres), payments (Razorpay), push, logging
packages/database/   Drizzle schema, migrations, repositories, runners, db:* scripts
packages/api-client/ typed fetch client for the frontends
packages/ui/         design system components
packages/web-core/   shared frontend code: providers, layouts, API proxy, features used by two or more apps
packages/testing/    test helpers (migrate-to, server-only stub)
packages/tooling/    shared tsconfig, ESLint and Vitest config
infra/               Dockerfile (one per-app image) and the compose stack
```

## Documentation

[architecture](docs/architecture.md) · [API reference](docs/api-reference.md) · [technology decisions](docs/technology-decisions.md) · [provider abstractions](docs/provider-abstractions.md) · [provider migration](docs/provider-migration-guide.md) · [database schema](docs/database-schema.md) · [tenant security](docs/tenant-security.md) · [offline sync](docs/offline-sync.md) · [environment variables](docs/environment-variables.md) · [deployment](docs/deployment.md) · [testing](docs/testing.md) · [roadmap](docs/implementation-roadmap.md)

Runbooks: [backup and restore](docs/runbooks/backup-and-restore.md) · [rollback](docs/runbooks/rollback.md) · [local data preservation](docs/runbooks/local-data-preservation.md) · [disable RLS (emergency)](docs/runbooks/disable-rls-emergency.md)

This repo uses a Next.js version with breaking changes; read the guides in `apps/console/node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).
