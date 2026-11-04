"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ApiError, errorMessage, type FieldErrors } from "@/lib/api-client";

/**
 * Runs a server call with a pending flag. Server field errors are returned via
 * `err(fieldName)` for inline display; any other failure becomes a toast.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setPending(true);
    setErrors({});
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
        if (error.fieldErrors._root?.[0]) toast.error(error.fieldErrors._root[0]);
      } else {
        toast.error(errorMessage(error));
      }
      return null;
    } finally {
      setPending(false);
    }
  }
  const err = (...names: string[]) => names.map((n) => errors[n]?.[0]).find(Boolean);
  return { pending, run, err };
}
