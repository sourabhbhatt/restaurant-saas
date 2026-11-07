"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { sessionKeys } from "../session/queries";

import { safeNextPath } from "./safe-next";

/** The validated `?next=` target (same-origin relative path) or the fallback. */
export function useNextTarget(fallback: string): string {
  const params = useSearchParams();
  return safeNextPath(params.get("next"), fallback);
}

/**
 * After a successful sign-in/up: refetch the session (so signed-in areas see
 * the new user rather than a cached 401) and then navigate.
 */
export function useCompleteAuth() {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(
    async (target: string) => {
      await qc.resetQueries({ queryKey: sessionKeys.me });
      router.replace(target);
    },
    [qc, router],
  );
}
