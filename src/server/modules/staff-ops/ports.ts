import type { NotificationInput } from "@/contracts/notifications";
import type { OrderDto } from "@/contracts/orders";
import type {
  BranchTableDto,
  KitchenOrderDto,
  SessionBillSummaryDto,
  StaffOrderListQuery,
  TableSessionSummaryDto,
} from "@/contracts/staff-ops";
import type { Permission } from "@/domain/access/permissions";
import type {
  OrderItemStatus,
  OrderPriority,
  OrderStatus,
} from "@/domain/orders/order-status";
import type { AuditRepository } from "@/server/ports/core-repositories";

/** Tenant filter taken from a server-resolved branch scope. */
export interface BranchTarget {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

export interface OrderRecord {
  id: string;
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  tableId: string;
  sessionId: string;
  orderNumber: number;
  status: OrderStatus;
  priority: OrderPriority;
  version: number;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  status: OrderItemStatus;
}

/** Explicit, whitelisted order columns a transition may set. */
export interface OrderTransitionPatch {
  acceptedAt?: Date;
  acceptedBy?: string;
  preparingAt?: Date;
  readyAt?: Date;
  servedAt?: Date;
  servedBy?: string;
  completedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  cancelledAt?: Date;
  cancellationReason?: string;
}

export interface BranchOpsSettings {
  kitchenDelayMinutes: number;
  kitchenSoundEnabled: boolean;
  waiterSoundEnabled: boolean;
}

export interface SessionRecord {
  id: string;
  tableId: string;
  tableName: string;
  tableSection: string | null;
  tableCapacity: number;
  tableIsActive: boolean;
  summary: TableSessionSummaryDto;
  bill: SessionBillSummaryDto | null;
}

export interface StaffOpsRepository {
  /**
   * Unscoped lookup used only to decide which branch scope to request. Callers
   * must authorize with the access service before reading anything else.
   */
  findOrderBranchId(orderId: string): Promise<string | null>;
  /** Order row inside the scope; `lock` takes a row lock (FOR UPDATE) in a transaction. */
  findOrder(
    target: BranchTarget,
    orderId: string,
    opts?: { lock?: boolean },
  ): Promise<OrderRecord | null>;
  getOrderDto(
    target: BranchTarget,
    orderId: string,
    opts?: { timeline?: boolean },
  ): Promise<OrderDto | null>;
  listOrders(target: BranchTarget, filter: StaffOrderListQuery): Promise<OrderDto[]>;
  listSessionOrders(target: BranchTarget, sessionId: string): Promise<OrderDto[]>;
  /**
   * Conditional update: only applies when the row still has `from` status and
   * `expectedVersion`. Returns the new record, or null if the race was lost.
   */
  transitionOrder(
    target: BranchTarget,
    orderId: string,
    input: {
      from: OrderStatus;
      to: OrderStatus;
      expectedVersion: number;
      patch: OrderTransitionPatch;
    },
  ): Promise<OrderRecord | null>;
  /** Set item statuses of an order; `onlyFrom` restricts which items change. */
  setItemStatuses(
    target: BranchTarget,
    orderId: string,
    status: OrderItemStatus,
    onlyFrom?: readonly OrderItemStatus[],
  ): Promise<void>;
  listOrderItems(target: BranchTarget, orderId: string): Promise<OrderItemRecord[]>;
  /** Conditional item update (WHERE status = from). Returns false if it changed meanwhile. */
  updateItemStatus(
    target: BranchTarget,
    orderId: string,
    itemId: string,
    from: OrderItemStatus,
    to: OrderItemStatus,
  ): Promise<boolean>;
  updatePriority(
    target: BranchTarget,
    orderId: string,
    priority: OrderPriority,
    expectedVersion: number,
  ): Promise<OrderRecord | null>;
  insertStatusHistory(input: {
    workspaceId: string;
    orderId: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    actorUserId: string;
    reason: string | null;
  }): Promise<void>;
  branchSettings(target: BranchTarget): Promise<BranchOpsSettings>;
  /** ACCEPTED / PREPARING / READY plus orders finished since `recentSince`. */
  kitchenFeed(
    target: BranchTarget,
    recentSince: Date,
    fallbackPrepMinutes: number,
  ): Promise<{ active: KitchenOrderDto[]; recent: KitchenOrderDto[] }>;
  /** Every table of the branch with its open session (if any) and live bill. */
  listBranchTables(target: BranchTarget): Promise<Omit<BranchTableDto, "status">[]>;
  findSession(target: BranchTarget, sessionId: string): Promise<SessionRecord | null>;
  /** In-app notifications to holders of `permission` at the branch (same transaction). */
  notifyBranch(
    target: BranchTarget,
    permission: Permission,
    input: NotificationInput,
    excludeUserIds?: readonly string[],
  ): Promise<number>;
}

export interface StaffOpsRepos {
  staffOps: StaffOpsRepository;
  audit: AuditRepository;
}
