# Restaurant SaaS

A multi-tenant, offline-first restaurant management platform: QR dine-in ordering, waiter approvals, kitchen display, counter billing, subscriptions and a Super Admin console.

**Stage:** project foundation. No database, authentication, storage, realtime, email or hosting provider has been selected or configured yet.

## Stack

| Concern              | Tool                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| Framework            | Next.js 16 (App Router, Turbopack, Cache Components)                                 |
| Language             | TypeScript, strict (+ `noUncheckedIndexedAccess`)                                    |
| Styling / UI         | Tailwind CSS v4, shadcn/ui (Radix primitives, `new-york` theme), lucide icons        |
| Client state         | Zustand                                                                              |
| Server state         | TanStack Query (`networkMode: "offlineFirst"`)                                       |
| Forms / validation   | React Hook Form + Zod                                                                |
| Local persistence    | Dexie.js (IndexedDB)                                                                 |
| PWA / service worker | Serwist (`@serwist/turbopack`), `public/manifest.json`, `/~offline` fallback         |
| Quality              | ESLint (Next + TanStack Query + Prettier), Prettier (+ Tailwind class sorting)       |
| Tests                | Vitest + Testing Library + fake-indexeddb (unit), Playwright (E2E, mobile + desktop) |

## Getting started

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:3000 (service worker disabled in dev)
```

| Script                                                 | What it does                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `pnpm build` / `pnpm start`                            | Production build / serve (the service worker is active here)               |
| `pnpm typecheck`                                       | Generate route types and run `tsc`                                         |
| `pnpm lint` / `pnpm lint:fix`                          | ESLint, zero warnings allowed                                              |
| `pnpm format` / `pnpm format:check`                    | Prettier                                                                   |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Vitest unit tests                                                          |
| `pnpm test:e2e`                                        | Playwright: builds, starts on port 3100, tests on Pixel 7 + Desktop Chrome |
| `pnpm check`                                           | typecheck + lint + format check + unit tests                               |

First Playwright run on a new machine: `pnpm exec playwright install chromium`.

## Structure

```
src/
  app/                 routes only (App Router)
    (public)/ (auth)/ (workspace)/   route groups (no URL segment)
    waiter/ kitchen/ menu/ superadmin/
    serwist/[path]/route.ts          serves the compiled service worker
    sw.ts                            service worker source
    ~offline/                        offline fallback page
  components/
    ui/                shadcn/ui primitives (generated/owned source)
    shared/            app-wide components (providers, ...)
    layouts/           role-specific shells
  features/<feature>/  UI, hooks, stores and logic per business feature
  infrastructure/<capability>/{interfaces,providers}/   see src/infrastructure/README.md
  lib/                 framework-level helpers (cn, query client)
tests/e2e/             Playwright specs
docs/                  architecture and decision records
```

**Provider independence is enforced by lint:** `src/app`, `src/features` and `src/components` can't import from `@/infrastructure/*/providers`.

## Adding shadcn/ui components

```bash
pnpm dlx shadcn@latest add dialog input form
```

`components.json` is already configured, so components land in `src/components/ui`. (The initial setup was done by hand because the build environment couldn't reach the shadcn registry. Nothing differs from a CLI init.)

## Documents

- [Technology decisions](docs/technology-decisions.md), including a decision log
- [Architecture overview](docs/architecture.md)
- [Implementation roadmap](docs/implementation-roadmap.md)
- [Account setup checklist](docs/setup-accounts.md)
