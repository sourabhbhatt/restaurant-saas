"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import type {
  BranchDto,
  BranchSettingsDto,
  branchSettingsSchema,
  createBranchSchema,
  createRestaurantSchema,
  RestaurantDetailDto,
  RestaurantDto,
  RestaurantListItemDto,
  updateBranchSchema,
  updateRestaurantSchema,
} from "@/contracts/tenancy";
import { api } from "@/lib/api-client";
import { sessionKeys } from "@/features/session/queries";

/** Query keys for restaurants, branches and branch settings. */
export const tenancyKeys = {
  restaurants: (workspaceId: string) => ["workspace", workspaceId, "restaurants"] as const,
  restaurant: (restaurantId: string) => ["restaurant", restaurantId] as const,
  branch: (branchId: string) => ["branch", branchId, "details"] as const,
  branchSettings: (branchId: string) => ["branch", branchId, "settings"] as const,
};

/** Public URL of an uploaded file key (served by the menu module). */
export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/v1/files/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

/** Invalidate everything that shows the workspace structure (shell, switcher, lists). */
export function useInvalidateStructure() {
  const qc = useQueryClient();
  return async (workspaceId: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: sessionKeys.structure(workspaceId) }),
      qc.invalidateQueries({ queryKey: sessionKeys.me }),
      qc.invalidateQueries({ queryKey: tenancyKeys.restaurants(workspaceId) }),
    ]);
  };
}

export function useRestaurants(workspaceId: string) {
  return useQuery({
    queryKey: tenancyKeys.restaurants(workspaceId),
    queryFn: ({ signal }) =>
      api.get<RestaurantListItemDto[]>(`/workspaces/${workspaceId}/restaurants`, undefined, signal),
    enabled: Boolean(workspaceId),
  });
}

export function useRestaurant(restaurantId: string) {
  return useQuery({
    queryKey: tenancyKeys.restaurant(restaurantId),
    queryFn: ({ signal }) =>
      api.get<RestaurantDetailDto>(`/restaurants/${restaurantId}`, undefined, signal),
    enabled: Boolean(restaurantId),
  });
}

export function useBranch(branchId: string) {
  return useQuery({
    queryKey: tenancyKeys.branch(branchId),
    queryFn: ({ signal }) => api.get<BranchDto>(`/branches/${branchId}`, undefined, signal),
    enabled: Boolean(branchId),
  });
}

export function useBranchSettings(branchId: string) {
  return useQuery({
    queryKey: tenancyKeys.branchSettings(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchSettingsDto>(`/branches/${branchId}/settings`, undefined, signal),
    enabled: Boolean(branchId),
  });
}

export function useCreateRestaurant(workspaceId: string) {
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: z.output<typeof createRestaurantSchema>) =>
      api.post<RestaurantDto>(`/workspaces/${workspaceId}/restaurants`, input),
    onSuccess: () => invalidate(workspaceId),
  });
}

export function useUpdateRestaurant(workspaceId: string, restaurantId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: z.output<typeof updateRestaurantSchema>) =>
      api.patch<RestaurantDetailDto>(`/restaurants/${restaurantId}`, input),
    onSuccess: async (data) => {
      qc.setQueryData(tenancyKeys.restaurant(restaurantId), data);
      await invalidate(workspaceId);
    },
  });
}

export function useArchiveRestaurant(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (restaurantId: string) => api.delete(`/restaurants/${restaurantId}`),
    onSuccess: async (_d, restaurantId) => {
      qc.removeQueries({ queryKey: tenancyKeys.restaurant(restaurantId) });
      await invalidate(workspaceId);
    },
  });
}

export function useCreateBranch(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: { restaurantId: string; data: z.output<typeof createBranchSchema> }) =>
      api.post<BranchDto>(`/restaurants/${input.restaurantId}/branches`, input.data),
    onSuccess: async (_d, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: tenancyKeys.restaurant(input.restaurantId) }),
        invalidate(workspaceId),
      ]);
    },
  });
}

export function useUpdateBranch(workspaceId: string, branchId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: z.output<typeof updateBranchSchema>) =>
      api.patch<BranchDto>(`/branches/${branchId}`, input),
    onSuccess: async (data) => {
      qc.setQueryData(tenancyKeys.branch(branchId), data);
      await Promise.all([
        qc.invalidateQueries({ queryKey: sessionKeys.branchContext(branchId) }),
        qc.invalidateQueries({ queryKey: tenancyKeys.restaurant(data.restaurantId) }),
        invalidate(workspaceId),
      ]);
    },
  });
}

export function useArchiveBranch(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: { branchId: string; restaurantId: string }) =>
      api.delete(`/branches/${input.branchId}`),
    onSuccess: async (_d, input) => {
      qc.removeQueries({ queryKey: ["branch", input.branchId] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: tenancyKeys.restaurant(input.restaurantId) }),
        invalidate(workspaceId),
      ]);
    },
  });
}

export function useUpdateBranchSettings(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: z.output<typeof branchSettingsSchema>) =>
      api.put<BranchSettingsDto>(`/branches/${branchId}/settings`, input),
    onSuccess: (data) => qc.setQueryData(tenancyKeys.branchSettings(branchId), data),
  });
}
