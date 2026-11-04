import { z } from "zod";

import { daysInclusive, MAX_RANGE_DAYS } from "@/domain/analytics/date-range";
import type { SubscriptionPhase } from "@/domain/subscriptions/entitlements";

/**
 * Analytics API contracts.
 *
 * Definitions used everywhere (documented in the UI too):
 * - Orders: every order placed in the period (any status).
 * - Valid orders: orders not REJECTED or CANCELLED.
 * - Order value: sum of valid orders' subtotals (pre-tax item value).
 * - Average order value (AOV): order value / valid orders.
 * - Completed: orders in SERVED or COMPLETED status.
 * - Cancelled: orders REJECTED or CANCELLED.
 * - Billed: grand total (incl. tax, service charge, net of discount) of non-void
 *   bills issued in the period.
 * - Collected: confirmed payments minus confirmed refunds recorded in the
 *   period (cash basis); voided payments never count.
 * - Dates are inclusive local calendar dates in each branch's time zone.
 */

const isoDate = z.iso.date({ message: "Use a date like 2026-01-31" });

const rangeShape = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};

function refineRange(v: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (v.from && v.to) {
    if (v.from > v.to) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "Must be on or before the end date",
      });
    } else if (daysInclusive(v.from, v.to) > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Choose a period of at most ${MAX_RANGE_DAYS} days`,
      });
    }
  }
}

export const analyticsRangeQuerySchema = z.object(rangeShape).superRefine(refineRange);
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

export const workspaceAnalyticsQuerySchema = z
  .object({
    ...rangeShape,
    restaurantId: z.uuid({ message: "Invalid restaurant" }).optional(),
    branchId: z.uuid({ message: "Invalid branch" }).optional(),
  })
  .superRefine(refineRange);
export type WorkspaceAnalyticsQuery = z.infer<typeof workspaceAnalyticsQuerySchema>;

// ---------------------------------------------------------------- shared DTOs

export interface AnalyticsRangeDto {
  from: string;
  to: string;
  days: number;
  previousFrom: string;
  previousTo: string;
  /** Time zone used for "today" defaults (branch time zone, or the first branch's). */
  timezone: string;
}

export interface SalesKpisDto {
  totalOrders: number;
  validOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  /** Minor units. */
  orderValue: number;
  averageOrderValue: number;
  billed: number;
  billCount: number;
  collected: number;
}

/** Percentage change vs the previous period; null when the previous value was 0. */
export type SalesDeltasDto = Record<keyof SalesKpisDto, number | null>;

export interface DailyPointDto {
  date: string;
  orders: number;
  validOrders: number;
  orderValue: number;
  billed: number;
  collected: number;
}

export interface HeatmapCellDto {
  /** 0 = Sunday … 6 = Saturday (local time). */
  weekday: number;
  hour: number;
  orders: number;
}

export interface ItemPerformanceDto {
  name: string;
  category: string | null;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface CategoryPerformanceDto {
  category: string;
  quantity: number;
  revenue: number;
  items: number;
}

export interface PaymentMethodRowDto {
  method: string;
  payments: number;
  paymentCount: number;
  refunds: number;
  refundCount: number;
  net: number;
}

// ---------------------------------------------------------------- branch

export interface TableUtilizationRowDto {
  tableId: string;
  name: string;
  section: string | null;
  capacity: number;
  sessions: number;
  /** Average duration of sessions closed in the period, minutes. */
  avgSessionMinutes: number | null;
  occupiedMinutes: number;
  occupancyPercent: number | null;
}

export interface TableUtilizationDto {
  tables: TableUtilizationRowDto[];
  totalSessions: number;
  avgSessionMinutes: number | null;
  /** Business-hours minutes in the period (per table). */
  openMinutes: number;
  occupancyPercent: number | null;
  /** How occupancy is approximated, for display. */
  method: string;
}

export interface KitchenItemDto {
  name: string;
  orders: number;
  quantity: number;
  avgPrepMinutes: number | null;
}

export interface KitchenMetricsDto {
  /** ACCEPTED → READY, minutes. */
  avgPrepMinutes: number | null;
  /** PENDING (placed) → ACCEPTED, minutes. */
  avgWaitMinutes: number | null;
  /** Accepted orders whose prep exceeded the branch delay threshold (or still cooking past it). */
  delayedOrders: number;
  /** Orders that reached READY. */
  ordersCompleted: number;
  ordersAccepted: number;
  delayThresholdMinutes: number;
  items: KitchenItemDto[];
}

export interface CashierMetricsDto {
  totalCollections: number;
  paymentCount: number;
  byMethod: PaymentMethodRowDto[];
  /** Balance still due on non-void bills issued in the period. */
  outstandingBalance: number;
  unpaidBills: number;
  /** Bills issued in the period that are currently partially paid. */
  partiallyPaidBills: number;
  refundsTotal: number;
  refundCount: number;
  voidedPayments: number;
  discountsTotal: number;
}

export interface BranchAnalyticsDto {
  branch: { id: string; name: string; restaurantName: string; currency: string; timezone: string };
  range: AnalyticsRangeDto;
  kpis: SalesKpisDto & { pendingNow: number };
  previous: SalesKpisDto;
  deltas: SalesDeltasDto;
  daily: DailyPointDto[];
  peakHours: HeatmapCellDto[];
  topItems: ItemPerformanceDto[];
  categories: CategoryPerformanceDto[];
  paymentMethods: PaymentMethodRowDto[];
  tables: TableUtilizationDto;
  kitchen: KitchenMetricsDto;
  cashier: CashierMetricsDto;
}

/**
 * Live branch snapshot for the overview page. Each section is null when the
 * caller lacks the permission for it (orders.view / kitchen.view,
 * tables.view, bills.view / payments.summary.view).
 */
export interface BranchLiveDto {
  branchId: string;
  currency: string;
  timezone: string;
  today: string;
  orders: {
    pending: number;
    inKitchen: number;
    ready: number;
    today: number;
  } | null;
  tables: { active: number; total: number; billRequested: number } | null;
  bills: { open: number; outstanding: number; collectedToday: number } | null;
}

// ---------------------------------------------------------------- workspace

export interface BranchComparisonRowDto {
  branchId: string;
  branchName: string;
  restaurantId: string;
  restaurantName: string;
  currency: string;
  orders: number;
  validOrders: number;
  cancelledOrders: number;
  orderValue: number;
  averageOrderValue: number;
  billed: number;
  collected: number;
  previousCollected: number;
  collectedDelta: number | null;
  avgPrepMinutes: number | null;
}

export interface RestaurantSummaryRowDto {
  restaurantId: string;
  restaurantName: string;
  branches: number;
  orders: number;
  validOrders: number;
  orderValue: number;
  billed: number;
  collected: number;
}

export type AnalyticsSection<T> =
  | { available: true; data: T }
  | {
      available: false;
      error: { code: "ENTITLEMENT_REQUIRED"; message: string; feature: string };
    };

export interface WorkspaceAnalyticsDto {
  workspaceId: string;
  range: AnalyticsRangeDto;
  currency: string;
  /** True when the included branches use more than one currency (totals then mix currencies). */
  mixedCurrencies: boolean;
  filters: { restaurantId: string | null; branchId: string | null };
  /** Branches included in this report (visible to the caller and permitted for reports). */
  branchIds: string[];
  kpis: SalesKpisDto & { pendingNow: number };
  previous: SalesKpisDto;
  deltas: SalesDeltasDto;
  daily: DailyPointDto[];
  topItems: ItemPerformanceDto[];
  paymentMethods: PaymentMethodRowDto[];
  restaurants: RestaurantSummaryRowDto[];
  /** Requires the `advanced_analytics` feature; otherwise an in-body ENTITLEMENT_REQUIRED. */
  branchComparison: AnalyticsSection<BranchComparisonRowDto[]>;
}

// ---------------------------------------------------------------- platform

export interface PlatformTotalsDto {
  workspaces: number;
  activeWorkspaces: number;
  trialWorkspaces: number;
  expiredTrials: number;
  paidWorkspaces: number;
  suspendedWorkspaces: number;
  deactivatedWorkspaces: number;
  restaurants: number;
  branches: number;
  users: number;
}

export interface RecentWorkspaceDto {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  planName: string | null;
  phase: SubscriptionPhase;
  restaurants: number;
  branches: number;
  members: number;
}

export interface PlanDistributionRowDto {
  planKey: string | null;
  planName: string;
  total: number;
  byPhase: Partial<Record<SubscriptionPhase, number>>;
}

export interface AdminAnalyticsDto {
  generatedAt: string;
  totals: PlatformTotalsDto;
  recentWorkspaces: RecentWorkspaceDto[];
  phaseDistribution: { phase: SubscriptionPhase; count: number }[];
  planDistribution: PlanDistributionRowDto[];
  /** New workspaces per ISO week (Monday, UTC), last 12 weeks. */
  workspaceGrowth: { weekStart: string; count: number; cumulative: number }[];
  trialConversion: { trialsStarted: number; converted: number; rate: number | null };
  /** Platform-wide order counts per UTC day, last 30 days (counts only). */
  usage: {
    ordersPerDay: { date: string; orders: number }[];
    ordersLast30Days: number;
    activeBranchesLast7Days: number;
    activeWorkspacesLast7Days: number;
  };
}
