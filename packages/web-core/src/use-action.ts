"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ApiError, errorMessage, type FieldErrors } from "@ros/api-client";

/**
 * Runs a server call with a pending flag. Server field errors are returned via
 * `err(fieldName)` for inline display; any other failure becomes a toast and
 * is also kept in `error` / `formError` so the form can show it next to its
 * submit button.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setPending(true);
    setErrors({});
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length > 0) {
        setErrors(e.fieldErrors);
        if (e.fieldErrors._root?.[0]) {
          toast.error(e.fieldErrors._root[0]);
          setError(e);
        }
      } else {
        toast.error(errorMessage(e));
        setError(e);
      }
      return null;
    } finally {
      setPending(false);
    }
  }
  const err = (...names: string[]) => names.map((n) => errors[n]?.[0]).find(Boolean);
  /** Field errors whose name starts with `prefix` (e.g. "taxes." for per-row errors). */
  const errFor = (prefix: string) =>
    Object.entries(errors)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k, v[0]] as const);
  const formError =
    error instanceof ApiError
      ? (error.fieldErrors._root?.[0] ?? error.message)
      : error
        ? errorMessage(error)
        : null;
  /** Show a client-side validation message the same way as a server field error. */
  const setFieldErrors = (next: FieldErrors) => setErrors(next);
  return { pending, run, err, errFor, error, formError, setFieldErrors };
}
