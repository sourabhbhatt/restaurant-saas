/**
 * Domain-level error. Thrown by pure business rules and application services;
 * mapped to an HTTP status by the API layer. `code` is stable and documented in
 * docs/api-reference.md, `message` is safe to show to end users.
 */
export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "STALE_VERSION"
  | "ENTITLEMENT_REQUIRED"
  | "LIMIT_REACHED"
  | "WORKSPACE_RESTRICTED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_MISMATCH"
  | "QR_INVALID"
  | "PAYMENT_REJECTED"
  | "TRIAL_ALREADY_USED"
  | "MAINTENANCE"
  | "BAD_REQUEST";

export type FieldErrors = Record<string, string[]>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    options: { fieldErrors?: FieldErrors; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new DomainError("FORBIDDEN", message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new DomainError("CONFLICT", message, { details });
export const validationFailed = (message: string, fieldErrors?: FieldErrors) =>
  new DomainError("VALIDATION_FAILED", message, { fieldErrors });

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
