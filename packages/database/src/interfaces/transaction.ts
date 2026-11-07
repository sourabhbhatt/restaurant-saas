/**
 * Unit-of-work port. Application services describe *what* must be atomic;
 * the database adapter decides *how*. Repositories handed to `run` are bound
 * to the transaction; those handed to `read` are not.
 *
 * `R` is the set of repositories a module needs, so each module declares its
 * own narrow repository interfaces (see packages/application/src/modules/<module>/ports.ts).
 */
export interface TransactionRunner<R> {
  run<T>(work: (repos: R) => Promise<T>): Promise<T>;
  read<T>(work: (repos: R) => Promise<T>): Promise<T>;
}

/** Thrown by adapters when a unique constraint is violated. */
export class UniqueViolationError extends Error {
  constructor(
    readonly constraint: string | undefined,
    cause?: unknown,
  ) {
    super(`Unique constraint violated${constraint ? `: ${constraint}` : ""}`, { cause });
    this.name = "UniqueViolationError";
  }
}

/**
 * Request identity the tenant runner hands to the database (row-level
 * security reads it). Bound per request by the server layer.
 */
export interface DbContext {
  workspaceId: string | null;
  userId: string | null;
}

/** Thrown when tenant data is touched without, or with conflicting, request context. */
export class TenantContextError extends Error {
  constructor(message: "TENANT_CONTEXT_MISSING" | "TENANT_CONTEXT_CONFLICT") {
    super(message);
    this.name = "TenantContextError";
  }
}
