"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import type { NotificationType } from "@/contracts/notifications";
import type {
  MarkNotificationsReadInput,
  MarkNotificationsReadResult,
  NotificationListDto,
  NotificationPreferenceDto,
  PushConfigDto,
} from "@/contracts/notifications-api";
import { api } from "@/lib/api-client";

export const BELL_POLL_MS = 30_000;

export interface NotificationFilters {
  workspaceId?: string;
  unread?: boolean;
  type?: NotificationType;
}

export const notificationKeys = {
  all: ["notifications"] as const,
  bell: (workspaceId: string | undefined) =>
    ["notifications", "bell", workspaceId ?? "all"] as const,
  list: (filters: NotificationFilters) =>
    [
      "notifications",
      "list",
      filters.workspaceId ?? "all",
      filters.unread ? "unread" : "any",
      filters.type ?? "all",
    ] as const,
  preferences: ["notifications", "preferences"] as const,
  pushConfig: ["push", "config"] as const,
};

function listQuery(filters: NotificationFilters, limit: number, cursor?: string) {
  return {
    limit,
    cursor,
    workspaceId: filters.workspaceId,
    unread: filters.unread ? "true" : undefined,
    type: filters.type,
  };
}

/** Bell: latest notifications + unread count, polled every 30s and on focus. */
export function useNotificationBell(workspaceId: string | undefined) {
  return useQuery({
    queryKey: notificationKeys.bell(workspaceId),
    queryFn: ({ signal }) =>
      api.get<NotificationListDto>("/notifications", listQuery({ workspaceId }, 8), signal),
    refetchInterval: BELL_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    // Saved on this device so the bell still shows recent items offline.
    meta: { persist: true },
  });
}

export function useNotificationList(filters: NotificationFilters) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api.get<NotificationListDto>("/notifications", listQuery(filters, 20, pageParam), signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

/** Mark read with an optimistic update of every cached list and badge. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkNotificationsReadInput) =>
      api.post<MarkNotificationsReadResult>("/notifications/read", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const now = new Date().toISOString();
      const ids = input.all ? null : new Set(input.ids ?? []);
      const touch = (page: NotificationListDto): NotificationListDto => {
        let marked = 0;
        const items = page.items.map((n) => {
          if (n.readAt || (ids && !ids.has(n.id))) return n;
          marked += 1;
          return { ...n, readAt: now };
        });
        return {
          ...page,
          items,
          unreadCount: input.all ? 0 : Math.max(0, page.unreadCount - marked),
        };
      };
      const snapshot = qc.getQueriesData({ queryKey: notificationKeys.all });
      qc.setQueriesData<NotificationListDto>(
        { queryKey: ["notifications", "bell"] },
        (old) => (old ? touch(old) : old),
      );
      qc.setQueriesData<InfiniteData<NotificationListDto>>(
        { queryKey: ["notifications", "list"] },
        (old) => (old ? { ...old, pages: old.pages.map(touch) } : old),
      );
      return { snapshot };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: ({ signal }) =>
      api.get<NotificationPreferenceDto[]>("/notifications/preferences", undefined, signal),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreferenceDto[]) =>
      api.put<NotificationPreferenceDto[]>("/notifications/preferences", { preferences }),
    onSuccess: (data) => qc.setQueryData(notificationKeys.preferences, data),
  });
}

export function usePushConfig() {
  return useQuery({
    queryKey: notificationKeys.pushConfig,
    queryFn: ({ signal }) => api.get<PushConfigDto>("/push/config", undefined, signal),
    staleTime: 60 * 60_000,
  });
}
