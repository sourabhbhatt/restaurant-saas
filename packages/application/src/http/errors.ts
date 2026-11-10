import { z } from "zod";

import { isDomainError, type DomainErrorCode, type FieldErrors } from "@ros/domain/shared/errors";
import { UniqueViolationError } from "@ros/database/interfaces/transaction";

export const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  STALE_VERSION: 409,
  ENTITLEMENT_REQUIRED: 402,
  LIMIT_REACHED: 402,
  WORKSPACE_RESTRICTED: 403,
  RATE_LIMITED: 429,
  IDEMPOTENCY_MISMATCH: 422,
  QR_INVALID: 404,
  PAYMENT_REJECTED: 422,
  TRIAL_ALREADY_USED: 409,
  MAINTENANCE: 503,
};

export interface ApiErrorBody {
  error: {
    code: DomainErrorCode | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE";
    message: string;
    fieldErrors?: FieldErrors;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

/** Seconds clients are told to wait when a dependency is unavailable. */
export const UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

const SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
]);
// SQLSTATE classes 08 (connection exception), 53 (insufficient resources, e.g.
// too_many_connections) and 57P0x (admin/crash shutdown, cannot_connect_now).
const SQLSTATE_UNAVAILABLE = /^(08|53|57P0)/;

function hasUnavailableCode(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && (SOCKET_CODES.has(code) || SQLSTATE_UNAVAILABLE.test(code));
}

/**
 * True for errors that mean "a dependency did not answer" (database down,
 * pool exhausted, connection dropped), which callers may retry, as opposed to
 * a defect in our code. Checks the error, its `cause` and, for Node's
 * happy-eyeballs `AggregateError`, each member.
 */
export function isUnavailableError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length) {
    const e = queue.shift();
    if (!e || typeof e !== "object" || seen.has(e) || seen.size > 8) continue;
    seen.add(e);
    if (hasUnavailableCode(e)) return true;
    const { cause, errors } = e as { cause?: unknown; errors?: unknown };
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
}

export function zodToFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_root";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Map any thrown value to a safe HTTP error. Internal details never leave the server. */
export function toErrorResponse(
  error: unknown,
  requestId: string,
): { status: number; body: ApiErrorBody } {
  if (isDomainError(error)) {
    return {
      status: STATUS_BY_CODE[error.code],
      body: {
        error: {
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
          details: error.details,
          requestId,
        },
      },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "Please correct the highlighted fields",
          fieldErrors: zodToFieldErrors(error),
          requestId,
        },
      },
    };
  }
  if (error instanceof UniqueViolationError) {
    return {
      status: 409,
      body: { error: { code: "CONFLICT", message: "This already exists", requestId } },
    };
  }
  if (isUnavailableError(error)) {
    return {
      status: 503,
      body: {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable. Please try again in a moment.",
          details: { retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS },
          requestId,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please try again.",
        requestId,
      },
    },
  };
}
