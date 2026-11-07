import type {
  CategoryPerformanceDto,
  HeatmapCellDto,
  ItemPerformanceDto,
  KitchenItemDto,
} from "@ros/contracts/analytics";
import type { OpeningHoursDay } from "@ros/domain/analytics/business-hours";
import type { WorkspaceSubscriptionRow } from "@ros/domain/analytics/subscription-summary";

/** A branch as analytics needs it. `timezone` comes from the branch row, never from a client. */
export interface AnalyticsBranch {
  id: string;
  name: string;
  code: string;
  restaurantId: string;
  restaurantName: string;
  timezone: string;
  currency: string;
  status: "ACTIVE" | "ARCHIVED";
  kitchenDelayMinutes: number;
  businessHours: OpeningHoursDay[];
}

/**
 * Which branches a query covers. Built by the service from a server-resolved
 * scope: every query filters by `workspaceId` AND `branchIds`.
 */
export interface BranchSelection {
  workspaceId: string;
  branchIds: string[];
}

/** Inclusive local dates (each branch's own time zone). */
export interface DateWindow {
  from: string;
  to: string;
}

export interface OrderTotals {
  totalOrders: number;
  validOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  orderValue: number;
}

export interface BillTotals {
  billed: number;
  billCount: number;
  discounts: number;
  outstanding: number;
  unpaidBills: number;
  partiallyPaidBills: number;
}

export interface PaymentMethodTotals {
  method: string;
  payments: number;
  paymentCount: number;
  refunds: number;
  refundCount: number;
}

export interface PaymentTotals {
  byMethod: PaymentMethodTotals[];
  voidedPayments: number;
}

export interface DailyRow {
  date: string;
  orders: number;
  validOrders: number;
  orderValue: number;
  billed: number;
  collected: number;
}

export interface TableUsageRow {
  tableId: string;
  name: string;
  section: string | null;
  capacity: number;
  sessions: number;
  closedSessions: number;
  avgSessionMinutes: number | null;
  occupiedMinutes: number;
}

export interface KitchenTotals {
  avgPrepMinutes: number | null;
  avgWaitMinutes: number | null;
  delayedOrders: number;
  ordersCompleted: number;
  ordersAccepted: number;
}

export interface BranchTotalsRow extends OrderTotals {
  branchId: string;
  billed: number;
  collected: number;
  avgPrepMinutes: number | null;
}

export interface LiveSnapshot {
  pendingOrders: number;
  inKitchen: number;
  readyOrders: number;
  ordersToday: number;
  activeTables: number;
  billRequested: number;
  totalTables: number;
  openBills: number;
  outstanding: number;
  collectedToday: number;
}

export interface PlatformCounts {
  workspaces: number;
  byStatus: Record<string, number>;
  restaurants: number;
  branches: number;
  users: number;
}

export interface RecentWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  restaurants: number;
  branches: number;
  members: number;
}

export interface AnalyticsRepository {
  listBranches(workspaceId: string): Promise<AnalyticsBranch[]>;
  orderTotals(sel: BranchSelection, w: DateWindow): Promise<OrderTotals>;
  billTotals(sel: BranchSelection, w: DateWindow): Promise<BillTotals>;
  paymentTotals(sel: BranchSelection, w: DateWindow): Promise<PaymentTotals>;
  /** Only dates with activity are returned; the service fills gaps. */
  daily(sel: BranchSelection, w: DateWindow): Promise<DailyRow[]>;
  peakHours(sel: BranchSelection, w: DateWindow): Promise<HeatmapCellDto[]>;
  topItems(sel: BranchSelection, w: DateWindow, limit: number): Promise<ItemPerformanceDto[]>;
  categories(sel: BranchSelection, w: DateWindow): Promise<CategoryPerformanceDto[]>;
  tableUsage(sel: BranchSelection, w: DateWindow, now: Date): Promise<TableUsageRow[]>;
  kitchenTotals(sel: BranchSelection, w: DateWindow, now: Date): Promise<KitchenTotals>;
  kitchenItems(sel: BranchSelection, w: DateWindow, limit: number): Promise<KitchenItemDto[]>;
  perBranch(sel: BranchSelection, w: DateWindow): Promise<BranchTotalsRow[]>;
  pendingNow(sel: BranchSelection): Promise<number>;
  live(sel: BranchSelection, today: string): Promise<LiveSnapshot>;

  // Platform (Super Admin) aggregates — counts only.
  platformCounts(): Promise<PlatformCounts>;
  workspaceSubscriptions(): Promise<(WorkspaceSubscriptionRow & { workspaceId: string })[]>;
  recentWorkspaces(limit: number): Promise<RecentWorkspaceRow[]>;
  workspacesCreatedSince(since: Date): Promise<{ weekStart: string; count: number }[]>;
  workspacesCreatedBefore(before: Date): Promise<number>;
  trialConversion(): Promise<{ trialsStarted: number; converted: number }>;
  ordersPerDay(since: Date): Promise<{ date: string; orders: number }[]>;
  activeSince(since: Date): Promise<{ branches: number; workspaces: number }>;
}
