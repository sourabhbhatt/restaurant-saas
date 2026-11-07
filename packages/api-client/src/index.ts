/**
 * Typed fetch wrapper for the REST API (/api/v1). Every UI data call goes
 * through here (usually via TanStack Query), so error handling is uniform:
 * failures throw `ApiError` with the server's stable `code`, a safe message
 * and optional field errors that forms map onto inputs.
 */

export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: FieldErrors;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? {};
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /** True when the request never reached the server (offline, DNS, CORS). */
  get isNetworkError(): boolean {
    return this.code === "NETWORK_ERROR";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Sent as Idempotency-Key; the server replays the first response for repeats. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export const API_BASE = "/api/v1";

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const url = path.startsWith("http") || path.startsWith("/api/") ? path : `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "You appear to be offline. Check your connection and try again.",
    });
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = (payload as { error?: Partial<ApiError> & { fieldErrors?: FieldErrors } } | null)
      ?.error;
    throw new ApiError({
      status: res.status,
      code:
        (err?.code as string | undefined) ??
        (res.status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"),
      message: (err?.message as string | undefined) ?? `Request failed (${res.status})`,
      fieldErrors: err?.fieldErrors,
      details: err?.details as Record<string, unknown> | undefined,
      requestId: res.headers.get("x-request-id"),
    });
  }
  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string, query?: ApiRequestOptions["query"], signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "POST", body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "PUT", body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body: body ?? {} }),
  delete: <T>(path: string, opts: Omit<ApiRequestOptions, "method"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};

/** New idempotency key (URL-safe, 22+ chars). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** User-facing message for any error thrown from a query or mutation. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Apply server field errors to a react-hook-form instance. Returns true if at
 * least one field error was applied (so callers can skip a generic toast).
 */
export function applyFieldErrors(
  error: unknown,
  setError: (name: never, error: { type: string; message: string }) => void,
  knownFields: readonly string[],
): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    if (knownFields.includes(field) && messages[0]) {
      setError(field as never, { type: "server", message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
