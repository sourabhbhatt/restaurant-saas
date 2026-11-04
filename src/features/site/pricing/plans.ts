"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { FEATURES, LIMIT_KEYS, type FeatureKey, type LimitKey } from "@/domain/subscriptions/entitlements";
import { isCurrencyCode, toMajor } from "@/domain/shared/money";
import { api, ApiError } from "@/lib/api-client";

/**
 * Public plans come from GET /api/v1/public/plans (platform module). Prices and
 * limits are data edited by Super Admin, so nothing here is hardcoded. The
 * parser is deliberately tolerant (array or `{ plans }` envelope, optional
 * fields) so a small contract difference degrades gracefully instead of
 * breaking the marketing site.
 */
const limitValue = z.number().nullable().optional();

const planSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  currency: z.string().nullish(),
  /** Minor units; null = custom pricing ("Contact us"). */
  monthlyPrice: z.number().nullish(),
  annualPrice: z.number().nullish(),
  isTrialEligible: z.boolean().optional(),
  limits: z.record(z.string(), limitValue).nullish(),
  features: z.array(z.string()).nullish(),
  sortOrder: z.number().optional(),
});

const responseSchema = z.union([
  z.array(planSchema),
  z.object({ plans: z.array(planSchema), trialDays: z.number().int().nullish() }),
]);

export interface PublicPlan {
  key: string;
  name: string;
  description: string | null;
  currency: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  isTrialEligible: boolean;
  /** Only the limits the API returned; null = unlimited. */
  limits: Partial<Record<LimitKey, number | null>>;
  features: FeatureKey[];
}

export interface PublicPlans {
  plans: PublicPlan[];
  trialDays: number | null;
}

const isFeatureKey = (k: string): k is FeatureKey => k in FEATURES;

export function parsePublicPlans(raw: unknown): PublicPlans {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 0,
      code: "BAD_RESPONSE",
      message: "Plans are temporarily unavailable.",
    });
  }
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.plans;
  const trialDays = Array.isArray(parsed.data) ? null : (parsed.data.trialDays ?? null);
  const plans = [...list]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map<PublicPlan>((p) => {
      const limits: PublicPlan["limits"] = {};
      for (const key of LIMIT_KEYS) {
        const value = p.limits?.[key];
        if (value !== undefined) limits[key] = value;
      }
      return {
        key: p.key,
        name: p.name,
        description: p.description ?? null,
        currency: p.currency ?? "INR",
        monthlyPrice: p.monthlyPrice ?? null,
        annualPrice: p.annualPrice ?? null,
        isTrialEligible: p.isTrialEligible ?? true,
        limits,
        features: (p.features ?? []).filter(isFeatureKey),
      };
    });
  return { plans, trialDays };
}

export const publicPlanKeys = { all: ["public", "plans"] as const };

export function usePublicPlans() {
  return useQuery({
    queryKey: publicPlanKeys.all,
    queryFn: async ({ signal }) =>
      parsePublicPlans(await api.get<unknown>("/public/plans", undefined, signal)),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export type BillingView = "monthly" | "annual";

/** Marketing price: drops ".00" for whole amounts (₹2,499 rather than ₹2,499.00). */
export function formatPlanPrice(minor: number, currency: string): string {
  const code = isCurrencyCode(currency) ? currency : "INR";
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: code,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(toMajor(minor, code));
}

export interface PlanPriceView {
  /** null → custom pricing ("Contact us"). */
  amount: string | null;
  period: string;
  note: string | null;
}

export function planPrice(plan: PublicPlan, view: BillingView): PlanPriceView {
  if (view === "annual") {
    if (plan.annualPrice != null) {
      return {
        amount: formatPlanPrice(plan.annualPrice, plan.currency),
        period: "/year",
        note: `≈ ${formatPlanPrice(Math.round(plan.annualPrice / 12), plan.currency)} per month, billed yearly`,
      };
    }
    if (plan.monthlyPrice != null) {
      return {
        amount: formatPlanPrice(plan.monthlyPrice, plan.currency),
        period: "/month",
        note: "Annual billing not offered for this plan",
      };
    }
    return { amount: null, period: "", note: null };
  }
  if (plan.monthlyPrice != null) {
    return { amount: formatPlanPrice(plan.monthlyPrice, plan.currency), period: "/month", note: null };
  }
  if (plan.annualPrice != null) {
    return {
      amount: formatPlanPrice(plan.annualPrice, plan.currency),
      period: "/year",
      note: "Billed yearly only",
    };
  }
  return { amount: null, period: "", note: null };
}

/** Annual saving vs. 12 × monthly, in whole percent (null when not applicable). */
export function annualSavingPercent(plan: PublicPlan): number | null {
  if (plan.monthlyPrice == null || plan.annualPrice == null || plan.monthlyPrice <= 0) return null;
  const full = plan.monthlyPrice * 12;
  const pct = Math.round(((full - plan.annualPrice) / full) * 100);
  return pct > 0 ? pct : null;
}

export const LIMIT_LABELS: Record<LimitKey, { label: string; unit?: string }> = {
  maxRestaurants: { label: "Restaurants" },
  maxBranches: { label: "Branches" },
  maxStaff: { label: "Staff accounts" },
  maxTables: { label: "Tables" },
  maxMenuItems: { label: "Menu items" },
  storageMb: { label: "Image storage", unit: "MB" },
};

export function formatLimit(key: LimitKey, value: number | null | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "Unlimited";
  const unit = LIMIT_LABELS[key].unit;
  if (unit === "MB" && value >= 1024 && value % 1024 === 0) return `${value / 1024} GB`;
  return unit ? `${value.toLocaleString("en-IN")} ${unit}` : value.toLocaleString("en-IN");
}
