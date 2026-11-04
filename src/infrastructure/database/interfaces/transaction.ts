/**
 * Unit-of-work port. Application services describe *what* must be atomic;
 * the database adapter decides *how*. Repositories handed to `run` are bound
 * to the transaction; those handed to `read` are not.
 *
 * `R` is the set of repositories a module needs, so each module declares its
 * own narrow repository interfaces (see src/server/modules/<module>/ports.ts).
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
