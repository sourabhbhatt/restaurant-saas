# Infrastructure

Everything that talks to an external provider lives here, and nowhere else.

```
<capability>/
  interfaces/   provider-neutral contracts (TypeScript interfaces + types)
  providers/    one folder per concrete provider, implementing the interfaces
```

Capabilities: `database`, `auth`, `storage`, `realtime`, `notifications`, `email`.

## Rules

1. `src/app`, `src/features` and `src/components` import from `@/infrastructure/<capability>/interfaces` only. ESLint (`no-restricted-imports`) fails the build if they import a provider.
2. Provider SDKs (database clients, auth SDKs, storage SDKs, ...) are imported only inside `providers/`.
3. Interfaces use our own domain types. They never return provider response objects, provider error classes or provider-specific URLs. Storage returns object keys, and URLs come from the storage interface.
4. The concrete provider for each capability is chosen in one place (a composition root, added when the first provider is) from environment configuration.
5. Every interface gets a shared contract test suite that each provider must pass. That's how a provider swap is verified.

No provider has been selected yet. See `docs/technology-decisions.md` for the evaluation.
