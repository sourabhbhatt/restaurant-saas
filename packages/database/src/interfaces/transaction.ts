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

/**
 * Production bundles load one copy of this module per API route while the
 * shared container's adapters throw with their own copy, so `instanceof`
 * checks a registered symbol rather than the class object.
 */
const UNIQUE_VIOLATION = Symbol.for("restaurantos.UniqueViolationError");
const TENANT_CONTEXT = Symbol.for("restaurantos.TenantContextError");
const branded = (value: unknown, brand: symbol) =>
  typeof value === "object" && value !== null && brand in value;

/** Thrown by adapters when a unique constraint is violated. */
export class UniqueViolationError extends Error {
  static override [Symbol.hasInstance](value: unknown): value is UniqueViolationError {
    return branded(value, UNIQUE_VIOLATION);
  }

  constructor(
    readonly constraint: string | undefined,
    cause?: unknown,
  ) {
    super(`Unique constraint violated${constraint ? `: ${constraint}` : ""}`, { cause });
    Object.defineProperty(this, UNIQUE_VIOLATION, { value: true });
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
  static override [Symbol.hasInstance](value: unknown): value is TenantContextError {
    return branded(value, TENANT_CONTEXT);
  }

  constructor(message: "TENANT_CONTEXT_MISSING" | "TENANT_CONTEXT_CONFLICT") {
    super(message);
    Object.defineProperty(this, TENANT_CONTEXT, { value: true });
    this.name = "TenantContextError";
  }
}
