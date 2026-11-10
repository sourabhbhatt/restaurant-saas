"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@ros/api-client";

import { parsePublicPlans, type PublicPlans } from "./plan-model";

export const publicPlanKeys = { all: ["public", "plans"] as const };

/**
 * Live public plans. `initial` is the server-rendered copy (see
 * server-plans.ts): plans are then in the HTML for crawlers and no-JS readers,
 * and the client refetches only once it is stale.
 */
export function usePublicPlans(initial?: { data: PublicPlans; fetchedAt: number }) {
  return useQuery({
    queryKey: publicPlanKeys.all,
    queryFn: async ({ signal }) =>
      parsePublicPlans(await api.get<unknown>("/public/plans", undefined, signal)),
    staleTime: 5 * 60_000,
    retry: 1,
    initialData: initial?.data,
    initialDataUpdatedAt: initial?.fetchedAt,
  });
}
