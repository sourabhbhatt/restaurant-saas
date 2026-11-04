import { z } from "zod";

import { DomainError, type DomainErrorCode, type FieldErrors } from "@/domain/shared/errors";
import { UniqueViolationError } from "@/infrastructure/database/interfaces/transaction";

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
};

export interface ApiErrorBody {
  error: {
    code: DomainErrorCode | "INTERNAL_ERROR";
    message: string;
    fieldErrors?: FieldErrors;
    details?: Record<string, unknown>;
    requestId: string;
  };
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
  if (error instanceof DomainError) {
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
