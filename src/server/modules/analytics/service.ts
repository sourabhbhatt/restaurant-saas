import type {
  AdminAnalyticsDto,
  AnalyticsRangeDto,
  AnalyticsSection,
  BranchAnalyticsDto,
  BranchComparisonRowDto,
  BranchLiveDto,
  DailyPointDto,
  PaymentMethodRowDto,
  PlanDistributionRowDto,
  RestaurantSummaryRowDto,
  SalesDeltasDto,
  SalesKpisDto,
  TableUtilizationDto,
  WorkspaceAnalyticsDto,
  WorkspaceAnalyticsQuery,
} from "@/contracts/analytics";
import { canViewBranchReports } from "@/domain/analytics/access";
import { occupancyPercent, openMinutesInRange } from "@/domain/analytics/business-hours";
import {
  addDaysIso,
  enumerateDates,
  localDate,
  percentChange,
  resolveRange,
  type ResolvedRange,
} from "@/domain/analytics/date-range";
import { classifyWorkspace, conversionRate } from "@/domain/analytics/subscription-summary";
import { forbidden, notFound } from "@/domain/shared/errors";
import {
  assertFeature,
  assertOperationAllowed,
  FEATURES,
  type SubscriptionPhase,
} from "@/domain/subscriptions/entitlements";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";

import type { BranchScope, WorkspaceScope } from "../../authz/access-service";
import type { Clock } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type {
  AnalyticsBranch,
  AnalyticsRepository,
  BillTotals,
  BranchSelection,
  OrderTotals,
  PaymentTotals,
} from "./ports";

export interface AnalyticsRepos {
  analytics: AnalyticsRepository;
}

export interface AnalyticsServiceDeps {
  tx: TransactionRunner<AnalyticsRepos>;
  /** Owner-level runner for the Super Admin platform aggregates only (they span workspaces). */
  platform: TransactionRunner<AnalyticsRepos>;
  clock: Clock;
  entitlements: EntitlementService;
}

const TOP_LIMIT = 10;
const OCCUPANCY_METHOD =
  "Minutes tables were held by a table session (opened in the period; open sessions count until now) divided by active tables × business-hours minutes in the period. Branches without business hours assume 12 open hours a day. Capped at 100%.";

function kpis(o: OrderTotals, b: BillTotals, p: PaymentTotals): SalesKpisDto {
  const collected = p.byMethod.reduce((s, m) => s + m.payments - m.refunds, 0);
  return {
    totalOrders: o.totalOrders,
    validOrders: o.validOrders,
    completedOrders: o.completedOrders,
    cancelledOrders: o.cancelledOrders,
    orderValue: o.orderValue,
    averageOrderValue: o.validOrders ? Math.round(o.orderValue / o.validOrders) : 0,
    billed: b.billed,
    billCount: b.billCount,
    collected,
  };
}

function deltas(current: SalesKpisDto, previous: SalesKpisDto): SalesDeltasDto {
  const out = {} as SalesDeltasDto;
  for (const key of Object.keys(current) as (keyof SalesKpisDto)[]) {
    out[key] = percentChange(current[key], previous[key]);
  }
  return out;
}

function methodRows(p: PaymentTotals): PaymentMethodRowDto[] {
  return p.byMethod.map((m) => ({ ...m, net: m.payments - m.refunds }));
}

function fillDaily(
  range: ResolvedRange,
  rows: Awaited<ReturnType<AnalyticsRepository["daily"]>>,
): DailyPointDto[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return enumerateDates(range.from, range.to).map(
    (date) =>
      byDate.get(date) ?? {
        date,
        orders: 0,
        validOrders: 0,
        orderValue: 0,
        billed: 0,
        collected: 0,
      },
  );
}

function rangeDto(range: ResolvedRange, timezone: string): AnalyticsRangeDto {
  return { ...range, timezone };
}

export function createAnalyticsService({
  tx,
  platform,
  clock,
  entitlements,
}: AnalyticsServiceDeps) {
  /** Reports may be read in any subscription phase except a platform suspension. */
  function assertReadable(scope: WorkspaceScope | BranchScope) {
    assertOperationAllowed(scope.entitlements, "read");
    assertFeature(scope.entitlements, "analytics");
  }

  async function salesSummary(r: AnalyticsRepos, sel: BranchSelection, range: ResolvedRange) {
    const prevWindow = { from: range.previousFrom, to: range.previousTo };
    const [o, b, p, po, pb, pp, pendingNow, daily] = await Promise.all([
      r.analytics.orderTotals(sel, range),
      r.analytics.billTotals(sel, range),
      r.analytics.paymentTotals(sel, range),
      r.analytics.orderTotals(sel, prevWindow),
      r.analytics.billTotals(sel, prevWindow),
      r.analytics.paymentTotals(sel, prevWindow),
      r.analytics.pendingNow(sel),
      r.analytics.daily(sel, range),
    ]);
    const current = kpis(o, b, p);
    const previous = kpis(po, pb, pp);
    return {
      bills: b,
      payments: p,
      kpis: { ...current, pendingNow },
      previous,
      deltas: deltas(current, previous),
      daily: fillDaily(range, daily),
    };
  }

  return {
    /** GET /branches/:branchId/analytics — requires `reports.view` at the branch. */
    async branch(
      scope: BranchScope,
      query: { from?: string; to?: string },
    ): Promise<BranchAnalyticsDto> {
      if (
        !canViewBranchReports(scope.grants, {
          restaurantId: scope.restaurantId,
          branchId: scope.branchId,
        })
      ) {
        throw forbidden();
      }
      assertReadable(scope);
      const now = clock.now();
      const tz = scope.branch.timezone;
      const range = resolveRange(query, localDate(now, tz));
      const sel: BranchSelection = { workspaceId: scope.workspaceId, branchIds: [scope.branchId] };

      return tx.read(async (r) => {
        const branches = await r.analytics.listBranches(scope.workspaceId);
        const branch = branches.find((b) => b.id === scope.branchId);
        if (!branch) throw notFound("Branch");
        const [summary, peakHours, topItems, categories, tables, kitchen, kitchenItems] =
          await Promise.all([
            salesSummary(r, sel, range),
            r.analytics.peakHours(sel, range),
            r.analytics.topItems(sel, range, TOP_LIMIT),
            r.analytics.categories(sel, range),
            r.analytics.tableUsage(sel, range, now),
            r.analytics.kitchenTotals(sel, range, now),
            r.analytics.kitchenItems(sel, range, TOP_LIMIT),
          ]);

        const openMinutes = openMinutesInRange(branch.businessHours, range.from, range.to);
        const totalSessions = tables.reduce((s, t) => s + t.sessions, 0);
        const closed = tables.reduce((s, t) => s + t.closedSessions, 0);
        const weightedMinutes = tables.reduce(
          (s, t) => s + (t.avgSessionMinutes ?? 0) * t.closedSessions,
          0,
        );
        const occupied = tables.reduce((s, t) => s + t.occupiedMinutes, 0);
        const tableDto: TableUtilizationDto = {
          tables: tables.map(({ closedSessions: _c, ...t }) => ({
            ...t,
            occupancyPercent: occupancyPercent(t.occupiedMinutes, 1, openMinutes),
          })),
          totalSessions,
          avgSessionMinutes: closed ? Math.round((weightedMinutes / closed) * 10) / 10 : null,
          openMinutes,
          occupancyPercent: occupancyPercent(occupied, tables.length, openMinutes),
          method: OCCUPANCY_METHOD,
        };

        const methods = methodRows(summary.payments);
        return {
          branch: {
            id: branch.id,
            name: branch.name,
            restaurantName: branch.restaurantName,
            currency: branch.currency,
            timezone: tz,
          },
          range: rangeDto(range, tz),
          kpis: summary.kpis,
          previous: summary.previous,
          deltas: summary.deltas,
          daily: summary.daily,
          peakHours,
          topItems,
          categories,
          paymentMethods: methods,
          tables: tableDto,
          kitchen: {
            ...kitchen,
            delayThresholdMinutes: branch.kitchenDelayMinutes,
            items: kitchenItems,
          },
          cashier: {
            totalCollections: summary.kpis.collected,
            paymentCount: methods.reduce((s, m) => s + m.paymentCount, 0),
            byMethod: methods,
            outstandingBalance: summary.bills.outstanding,
            unpaidBills: summary.bills.unpaidBills,
            partiallyPaidBills: summary.bills.partiallyPaidBills,
            refundsTotal: methods.reduce((s, m) => s + m.refunds, 0),
            refundCount: methods.reduce((s, m) => s + m.refundCount, 0),
            voidedPayments: summary.payments.voidedPayments,
            discountsTotal: summary.bills.discounts,
          },
        };
      });
    },

    /**
     * GET /branches/:branchId/analytics/live — operational snapshot for the
     * branch overview. Needs only `branch.view` (enforced by forBranch);
     * each section is included only with its own permission.
     */
    async live(scope: BranchScope): Promise<BranchLiveDto> {
      assertOperationAllowed(scope.entitlements, "read");
      const tz = scope.branch.timezone;
      const today = localDate(clock.now(), tz);
      const sel: BranchSelection = { workspaceId: scope.workspaceId, branchIds: [scope.branchId] };
      const snap = await tx.read((r) => r.analytics.live(sel, today));
      const canOrders = scope.can("orders.view") || scope.can("kitchen.view");
      const canTables = scope.can("tables.view");
      const canBills = scope.can("bills.view") || scope.can("payments.summary.view");
      return {
        branchId: scope.branchId,
        currency: scope.branch.currency,
        timezone: tz,
        today,
        orders: canOrders
          ? {
              pending: snap.pendingOrders,
              inKitchen: snap.inKitchen,
              ready: snap.readyOrders,
              today: snap.ordersToday,
            }
          : null,
        tables: canTables
          ? {
              active: snap.activeTables,
              total: snap.totalTables,
              billRequested: snap.billRequested,
            }
          : null,
        bills: canBills
          ? {
              open: snap.openBills,
              outstanding: snap.outstanding,
              collectedToday: snap.collectedToday,
            }
          : null,
      };
    },

    /**
     * GET /workspaces/:workspaceId/analytics.
     *
     * Access: `workspace.analytics.view` covers every branch the caller can
     * see; otherwise the report covers only branches where the caller holds
     * `reports.view` (403 if none). `restaurantId` / `branchId` filters must
     * name something inside that set, else 404. Requires the `analytics`
     * feature; the per-branch comparison additionally needs
     * `advanced_analytics` and is otherwise returned as an in-body
     * ENTITLEMENT_REQUIRED section while the rest of the report is served.
     */
    async workspace(
      scope: WorkspaceScope,
      query: WorkspaceAnalyticsQuery,
    ): Promise<WorkspaceAnalyticsDto> {
      const workspaceWide = scope.can("workspace.analytics.view");
      const now = clock.now();

      return tx.read(async (r) => {
        const all = await r.analytics.listBranches(scope.workspaceId);
        const filter = scope.branchFilter();
        const visible = filter
          ? all.filter(
              (b) =>
                filter.restaurantIds.includes(b.restaurantId) || filter.branchIds.includes(b.id),
            )
          : all;
        const permitted = workspaceWide
          ? visible
          : visible.filter((b) =>
              canViewBranchReports(scope.grants, { restaurantId: b.restaurantId, branchId: b.id }),
            );
        if (!workspaceWide && permitted.length === 0) throw forbidden();
        assertReadable(scope);

        let selected: AnalyticsBranch[] = permitted;
        if (query.restaurantId) {
          selected = selected.filter((b) => b.restaurantId === query.restaurantId);
          if (!selected.length) throw notFound("Restaurant");
        }
        if (query.branchId) {
          selected = selected.filter((b) => b.id === query.branchId);
          if (!selected.length) throw notFound("Branch");
        }

        const tz = selected[0]?.timezone ?? permitted[0]?.timezone ?? "UTC";
        const range = resolveRange(query, localDate(now, tz));
        const sel: BranchSelection = {
          workspaceId: scope.workspaceId,
          branchIds: selected.map((b) => b.id),
        };
        const prev = { from: range.previousFrom, to: range.previousTo };
        const [summary, topItems, perBranch, perBranchPrev] = await Promise.all([
          salesSummary(r, sel, range),
          r.analytics.topItems(sel, range, TOP_LIMIT),
          r.analytics.perBranch(sel, range),
          r.analytics.perBranch(sel, prev),
        ]);

        const byId = new Map(selected.map((b) => [b.id, b]));
        const restaurants = new Map<string, RestaurantSummaryRowDto>();
        for (const row of perBranch) {
          const b = byId.get(row.branchId)!;
          const agg = restaurants.get(b.restaurantId) ?? {
            restaurantId: b.restaurantId,
            restaurantName: b.restaurantName,
            branches: 0,
            orders: 0,
            validOrders: 0,
            orderValue: 0,
            billed: 0,
            collected: 0,
          };
          agg.branches += 1;
          agg.orders += row.totalOrders;
          agg.validOrders += row.validOrders;
          agg.orderValue += row.orderValue;
          agg.billed += row.billed;
          agg.collected += row.collected;
          restaurants.set(b.restaurantId, agg);
        }

        let branchComparison: AnalyticsSection<BranchComparisonRowDto[]>;
        if (scope.entitlements.features.includes("advanced_analytics")) {
          const prevById = new Map(perBranchPrev.map((p) => [p.branchId, p]));
          branchComparison = {
            available: true,
            data: perBranch.map((row) => {
              const b = byId.get(row.branchId)!;
              const previousCollected = prevById.get(row.branchId)?.collected ?? 0;
              return {
                branchId: b.id,
                branchName: b.name,
                restaurantId: b.restaurantId,
                restaurantName: b.restaurantName,
                currency: b.currency,
                orders: row.totalOrders,
                validOrders: row.validOrders,
                cancelledOrders: row.cancelledOrders,
                orderValue: row.orderValue,
                averageOrderValue: row.validOrders
                  ? Math.round(row.orderValue / row.validOrders)
                  : 0,
                billed: row.billed,
                collected: row.collected,
                previousCollected,
                collectedDelta: percentChange(row.collected, previousCollected),
                avgPrepMinutes: row.avgPrepMinutes,
              };
            }),
          };
        } else {
          branchComparison = {
            available: false,
            error: {
              code: "ENTITLEMENT_REQUIRED",
              message: `${FEATURES.advanced_analytics} is not included in your plan`,
              feature: "advanced_analytics",
            },
          };
        }

        const currencies = [...new Set(selected.map((b) => b.currency))];
        return {
          workspaceId: scope.workspaceId,
          range: rangeDto(range, tz),
          currency: currencies[0] ?? "INR",
          mixedCurrencies: currencies.length > 1,
          filters: { restaurantId: query.restaurantId ?? null, branchId: query.branchId ?? null },
          branchIds: sel.branchIds,
          kpis: summary.kpis,
          previous: summary.previous,
          deltas: summary.deltas,
          daily: summary.daily,
          topItems,
          paymentMethods: methodRows(summary.payments),
          restaurants: [...restaurants.values()].sort((a, b) => b.collected - a.collected),
          branchComparison,
        };
      });
    },

    /** GET /admin/analytics — platform aggregates for Super Admin (route auth "platform"). */
    async platform(): Promise<AdminAnalyticsDto> {
      const now = clock.now();
      const settings = await entitlements.getPlatformSettings();
      const policy = { graceDays: settings.graceDays, restrictedMode: settings.restrictedMode };
      const today = now.toISOString().slice(0, 10);
      // Monday of the current ISO week, 11 weeks back → 12 weekly buckets.
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      const firstWeek = addDaysIso(today, -dow - 7 * 11);
      const usageFrom = addDaysIso(today, -29);

      return platform.read(async (r) => {
        const [counts, subs, recent, growth, before, conversion, perDay, active] =
          await Promise.all([
            r.analytics.platformCounts(),
            r.analytics.workspaceSubscriptions(),
            r.analytics.recentWorkspaces(10),
            r.analytics.workspacesCreatedSince(new Date(`${firstWeek}T00:00:00Z`)),
            r.analytics.workspacesCreatedBefore(new Date(`${firstWeek}T00:00:00Z`)),
            r.analytics.trialConversion(),
            r.analytics.ordersPerDay(new Date(`${usageFrom}T00:00:00Z`)),
            r.analytics.activeSince(new Date(now.getTime() - 7 * 86_400_000)),
          ]);

        const phases = new Map<SubscriptionPhase, number>();
        const plans = new Map<string, PlanDistributionRowDto>();
        const phaseById = new Map<string, SubscriptionPhase>();
        const planNameById = new Map<string, string | null>();
        let trial = 0;
        let expiredTrials = 0;
        let paid = 0;
        for (const row of subs) {
          const cls = classifyWorkspace(row, policy, now);
          phaseById.set(row.workspaceId, cls.phase);
          planNameById.set(row.workspaceId, row.plan?.name ?? null);
          phases.set(cls.phase, (phases.get(cls.phase) ?? 0) + 1);
          if (cls.trial) trial++;
          if (cls.expiredTrial) expiredTrials++;
          if (cls.paid) paid++;
          const key = row.plan?.key ?? "__none__";
          const plan = plans.get(key) ?? {
            planKey: row.plan?.key ?? null,
            planName: row.plan?.name ?? "No plan",
            total: 0,
            byPhase: {},
          };
          plan.total += 1;
          plan.byPhase[cls.phase] = (plan.byPhase[cls.phase] ?? 0) + 1;
          plans.set(key, plan);
        }

        const growthByWeek = new Map(growth.map((g) => [g.weekStart, g.count]));
        let cumulative = before;
        const workspaceGrowth = Array.from({ length: 12 }, (_, i) => {
          const weekStart = addDaysIso(firstWeek, i * 7);
          const count = growthByWeek.get(weekStart) ?? 0;
          cumulative += count;
          return { weekStart, count, cumulative };
        });

        const perDayMap = new Map(perDay.map((d) => [d.date, d.orders]));
        const ordersPerDay = enumerateDates(usageFrom, today).map((date) => ({
          date,
          orders: perDayMap.get(date) ?? 0,
        }));

        return {
          generatedAt: now.toISOString(),
          totals: {
            workspaces: counts.workspaces,
            activeWorkspaces: counts.byStatus.ACTIVE ?? 0,
            trialWorkspaces: trial,
            expiredTrials,
            paidWorkspaces: paid,
            suspendedWorkspaces: counts.byStatus.SUSPENDED ?? 0,
            deactivatedWorkspaces: counts.byStatus.DEACTIVATED ?? 0,
            restaurants: counts.restaurants,
            branches: counts.branches,
            users: counts.users,
          },
          recentWorkspaces: recent.map((w) => ({
            id: w.id,
            name: w.name,
            slug: w.slug,
            status: w.status,
            createdAt: w.createdAt.toISOString(),
            planName: planNameById.get(w.id) ?? null,
            phase: phaseById.get(w.id) ?? "NONE",
            restaurants: w.restaurants,
            branches: w.branches,
            members: w.members,
          })),
          phaseDistribution: [...phases.entries()]
            .map(([phase, count]) => ({ phase, count }))
            .sort((a, b) => b.count - a.count),
          planDistribution: [...plans.values()].sort((a, b) => b.total - a.total),
          workspaceGrowth,
          trialConversion: {
            ...conversion,
            rate: conversionRate(conversion.converted, conversion.trialsStarted),
          },
          usage: {
            ordersPerDay,
            ordersLast30Days: ordersPerDay.reduce((s, d) => s + d.orders, 0),
            activeBranchesLast7Days: active.branches,
            activeWorkspacesLast7Days: active.workspaces,
          },
        };
      });
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
