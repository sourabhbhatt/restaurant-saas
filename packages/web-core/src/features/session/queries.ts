"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import type { MeResponse } from "@ros/contracts/auth";
import type { BranchContextDto, WorkspaceStructureDto } from "@ros/contracts/structure";
import { clearDeviceUserData, unsentChangesCount } from "../offline";
import { api, ApiError } from "@ros/api-client";

/** Shared query keys for session-level data. Feature modules define their own keys. */
export const sessionKeys = {
  me: ["me"] as const,
  structure: (workspaceId: string) => ["workspace", workspaceId, "structure"] as const,
  branchContext: (branchId: string) => ["branch", branchId, "context"] as const,
};

/** When this JS bundle started running (used to tell restored cache from fresh server data). */
const PAGE_LOADED_AT = Date.now();

const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

export function useMe() {
  return useQuery({
    queryKey: sessionKeys.me,
    queryFn: ({ signal }) => api.get<MeResponse>("/auth/me", undefined, signal),
    retry: noRetryOnAuth,
    // Identity only changes on sign-in/out or a profile edit (all invalidate this
    // query), so it is not refetched on every focus or navigation.
    // Cache restored from IndexedDB is always stale: confirm with the server once per
    // page load, then keep the confirmed identity for 5 minutes.
    staleTime: (query) => (query.state.dataUpdatedAt < PAGE_LOADED_AT ? 0 : 5 * 60_000),
    refetchOnWindowFocus: false,
  });
}

/**
 * The signed-in user as confirmed by the server on this page load. Data restored
 * from the offline cache is never shown as identity while the server can still
 * answer; if the server is unreachable the cached identity is used instead.
 */
export function useIdentity() {
  const me = useMe();
  // Data restored from IndexedDB carries its old timestamp; anything fetched from the
  // server during this page load is newer than PAGE_LOADED_AT.
  const confirmed = me.dataUpdatedAt >= PAGE_LOADED_AT || me.isError;
  return {
    me: me.data,
    user: confirmed ? me.data?.user : undefined,
    workspaces: confirmed ? (me.data?.workspaces ?? []) : [],
    ready: confirmed && Boolean(me.data),
  };
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
    const unsent = unsentChangesCount();
    if (
      unsent > 0 &&
      !window.confirm(
        `You have ${unsent} unsent ${unsent === 1 ? "change" : "changes"}. ` +
          "They will be sent only after you sign in again on this device. Sign out anyway?",
      )
    ) {
      return;
    }
    try {
      await api.post("/auth/signout");
    } finally {
      // Forget everything about this account on the device, then go to login.
      qc.clear();
      await clearDeviceUserData();
      router.replace("/sign-in");
    }
  }, [qc, router]);
}
