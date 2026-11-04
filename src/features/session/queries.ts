"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import type { MeResponse } from "@/contracts/auth";
import type { BranchContextDto, WorkspaceStructureDto } from "@/contracts/structure";
import { api, ApiError } from "@/lib/api-client";

/** Shared query keys for session-level data. Feature modules define their own keys. */
export const sessionKeys = {
  me: ["me"] as const,
  structure: (workspaceId: string) => ["workspace", workspaceId, "structure"] as const,
  branchContext: (branchId: string) => ["branch", branchId, "context"] as const,
};

const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

export function useMe() {
  return useQuery({
    queryKey: sessionKeys.me,
    queryFn: ({ signal }) => api.get<MeResponse>("/auth/me", undefined, signal),
    retry: noRetryOnAuth,
    staleTime: 60_000,
  });
}

export function useWorkspaceStructure(workspaceId: string | undefined) {
  return useQuery({
    queryKey: sessionKeys.structure(workspaceId ?? ""),
    queryFn: ({ signal }) =>
      api.get<WorkspaceStructureDto>(`/workspaces/${workspaceId}/structure`, undefined, signal),
    enabled: Boolean(workspaceId),
    retry: noRetryOnAuth,
  });
}

export function useBranchContext(branchId: string | undefined) {
  return useQuery({
    queryKey: sessionKeys.branchContext(branchId ?? ""),
    queryFn: ({ signal }) =>
      api.get<BranchContextDto>(`/branches/${branchId}/context`, undefined, signal),
    enabled: Boolean(branchId),
    retry: noRetryOnAuth,
  });
}

/** `can("orders.approve")` for showing/hiding UI. The server always re-checks. */
export function permissionChecker(permissions: readonly string[] | undefined) {
  const set = new Set(permissions ?? []);
  return (permission: string) => set.has(permission);
}

export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    try {
      await api.post("/auth/signout");
    } finally {
      qc.clear();
      router.replace("/sign-in");
    }
  }, [qc, router]);
}
