"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import { sessionKeys } from "../session/queries";
import { api, errorMessage } from "@ros/api-client";

/**
 * Switch the active workspace. The server verifies membership and only changes
 * the session's workspace pointer; the signed-in account is untouched, so the
 * identity query is refreshed but never replaced.
 */
export function useSwitchWorkspace(currentId?: string) {
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(
    async (id: string) => {
      if (id === currentId) return;
      try {
        await api.put("/auth/active-workspace", { workspaceId: id });
        await qc.invalidateQueries({ queryKey: sessionKeys.me });
        router.push(`/app/w/${id}`);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [currentId, qc, router],
  );
}
