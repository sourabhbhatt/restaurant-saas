"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BranchMenu,
  BranchOverrideDto,
  BranchOverrideInput,
  CreateCategoryInput,
  CreateItemInput,
  MenuCategoryDto,
  MenuItemDto,
  MenuTreeDto,
  UpdateCategoryInput,
  UpdateItemInput,
  UploadPurpose,
  UploadResultDto,
} from "@ros/contracts/menu";
import { API_BASE, ApiError, api } from "@ros/api-client";

const menuKeys = {
  all: ["menu"] as const,
  tree: (restaurantId: string) => ["menu", "tree", restaurantId] as const,
  branch: (branchId: string) => ["menu", "branch", branchId] as const,
  overrides: (branchId: string) => ["menu", "overrides", branchId] as const,
};

const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

export function useMenuTree(restaurantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: menuKeys.tree(restaurantId ?? ""),
    queryFn: ({ signal }) =>
      api.get<MenuTreeDto>(`/restaurants/${restaurantId}/menu`, undefined, signal),
    enabled: Boolean(restaurantId) && enabled,
    retry: noRetryOnAuth,
  });
}

/** Branch-effective menu (overrides applied, unavailable items flagged). */
export function useBranchMenu(branchId: string, enabled = true) {
  return useQuery({
    queryKey: menuKeys.branch(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchMenu>(`/branches/${branchId}/menu`, { includeUnavailable: "true" }, signal),
    enabled,
    retry: noRetryOnAuth,
  });
}

export function useBranchOverrides(branchId: string, enabled = true) {
  return useQuery({
    queryKey: menuKeys.overrides(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchOverrideDto[]>(`/branches/${branchId}/menu/overrides`, undefined, signal),
    enabled,
    retry: noRetryOnAuth,
  });
}

function useInvalidateMenu() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: menuKeys.all });
}

export function useCreateCategory(restaurantId: string) {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      api.post<MenuCategoryDto>(`/restaurants/${restaurantId}/menu/categories`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryInput & { id: string }) =>
      api.patch<MenuCategoryDto>(`/menu/categories/${id}`, input),
    onSettled: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/menu/categories/${id}`),
    onSuccess: invalidate,
  });
}

export function useCreateItem(restaurantId: string) {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (input: CreateItemInput) =>
      api.post<MenuItemDto>(`/restaurants/${restaurantId}/menu/items`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateItemInput & { id: string }) =>
      api.patch<MenuItemDto>(`/menu/items/${id}`, input),
    onSettled: invalidate,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/menu/items/${id}`),
    onSuccess: invalidate,
  });
}

/** Restaurant-wide availability (all branches). */
export function useSetAvailability(restaurantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      api.patch<MenuItemDto>(`/menu/items/${id}/availability`, { isAvailable }),
    onMutate: async ({ id, isAvailable }) => {
      if (!restaurantId) return;
      const key = menuKeys.tree(restaurantId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MenuTreeDto>(key);
      if (prev) {
        qc.setQueryData<MenuTreeDto>(key, {
          ...prev,
          categories: prev.categories.map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === id ? { ...i, isAvailable } : i)),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (restaurantId && ctx?.prev) qc.setQueryData(menuKeys.tree(restaurantId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: menuKeys.all }),
  });
}

/** Branch override: omitted fields unchanged, null = inherit. */
export function usePutOverride(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...input }: BranchOverrideInput & { itemId: string }) =>
      api.put<BranchOverrideDto>(`/branches/${branchId}/menu/overrides/${itemId}`, input),
    onMutate: async ({ itemId, ...input }) => {
      const key = menuKeys.overrides(branchId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BranchOverrideDto[]>(key);
      if (prev) {
        const existing = prev.find((o) => o.itemId === itemId);
        const merged: BranchOverrideDto = {
          itemId,
          branchId,
          price: existing?.price ?? null,
          discountedPrice: existing?.discountedPrice ?? null,
          isAvailable: existing?.isAvailable ?? null,
          updatedAt: new Date().toISOString(),
          ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        };
        qc.setQueryData<BranchOverrideDto[]>(key, [
          ...prev.filter((o) => o.itemId !== itemId),
          merged,
        ]);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(menuKeys.overrides(branchId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: menuKeys.all }),
  });
}

/** Multipart image upload (the JSON api client cannot send FormData). */
export async function uploadImage(input: {
  workspaceId: string;
  file: File;
  purpose: UploadPurpose;
  restaurantId?: string;
}): Promise<UploadResultDto> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("purpose", input.purpose);
  if (input.restaurantId) form.set("restaurantId", input.restaurantId);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/workspaces/${input.workspaceId}/uploads`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "You appear to be offline. Check your connection and try again.",
    });
  }
  const payload = (await res.json().catch(() => null)) as {
    data?: UploadResultDto;
    error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
  } | null;
  if (!res.ok || !payload?.data) {
    throw new ApiError({
      status: res.status,
      code: payload?.error?.code ?? "REQUEST_FAILED",
      message: payload?.error?.message ?? `Upload failed (${res.status})`,
      fieldErrors: payload?.error?.fieldErrors,
      requestId: res.headers.get("x-request-id"),
    });
  }
  return payload.data;
}
