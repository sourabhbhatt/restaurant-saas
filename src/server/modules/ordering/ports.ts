import type { GuestBillDto } from "@/contracts/billing";
import type { NotificationInput } from "@/contracts/notifications";
import type { BranchMenu } from "@/contracts/menu";
import type { GuestOrderViewDto } from "@/contracts/ordering";
import type { OrderDto } from "@/contracts/orders";
import type { Permission } from "@/domain/access/permissions";
import type { OrderPriority, OrderStatus } from "@/domain/orders/order-status";
import type { SnapshotLine } from "@/domain/orders/order-lines";
import type { SessionStatus } from "@/domain/tables/table-status";
import type { AuditRepository } from "@/server/ports/core-repositories";

export interface BranchTarget {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

/** Everything about a table needed to serve a guest (resolved server-side). */
export interface TableContext extends BranchTarget {
  tableId: string;
  tableName: string;
  branchName: string;
  restaurantName: string;
  currency: string;
  restaurant: {
    description: string | null;
    logoKey: string | null;
    coverKey: string | null;
    brandColor: string | null;
    welcomeMessage: string | null;
    showPrepTime: boolean;
    showAllergens: boolean;
  };
  acceptingOrders: boolean;
  allowCustomerBillRequest: boolean;
  /** Table, branch, restaurant and workspace are all active and not deleted. */
  operational: boolean;
}

export interface SessionRecord {
  id: string;
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  tableId: string;
  status: SessionStatus;
  openedAt: Date;
  billRequestedAt: Date | null;
  version: number;
}

export interface GuestRecord {
  memberId: string;
  session: SessionRecord;
  table: TableContext;
}

export interface ExistingOrderRef {
  id: string;
  source: "CUSTOMER" | "STAFF";
  memberId: string | null;
  placedByUserId: string | null;
  sessionId: string;
}

export interface NewOrderRecord {
  target: BranchTarget;
  tableId: string;
  sessionId: string;
  memberId: string | null;
  placedByUserId: string | null;
  source: "CUSTOMER" | "STAFF";
  orderNumber: number;
  status: OrderStatus;
  priority: OrderPriority;
  specialInstructions: string | null;
  currency: string;
  subtotal: number;
  itemCount: number;
  idempotencyKey: string;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  lines: SnapshotLine[];
  history: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: "USER" | "GUEST";
    actorUserId: string | null;
  }[];
}

export interface OrderingRepository {
  /** ACTIVE QR token → table context (null when unknown or revoked). */
  findTableByQrHash(tokenHash: string): Promise<TableContext | null>;
  /** Table inside a branch (scope ids), not deleted. */
  findTableInBranch(target: BranchTarget, tableId: string): Promise<TableContext | null>;
  findOpenSession(workspaceId: string, tableId: string): Promise<SessionRecord | null>;
  /** SELECT ... FOR UPDATE on the session row (serialises with billing). */
  lockSession(workspaceId: string, sessionId: string): Promise<SessionRecord | null>;
  /** Any order in the session that is not rejected/cancelled (any guest or staff). */
  sessionHasActiveOrders(workspaceId: string, sessionId: string): Promise<boolean>;
  /** Insert an OPEN session; returns null if another non-closed session won the race. */
  tryInsertSession(input: {
    target: BranchTarget;
    tableId: string;
    openedBy: string | null;
  }): Promise<SessionRecord | null>;
  findGuestByTokenHash(tokenHash: string): Promise<GuestRecord | null>;
  insertMember(input: {
    workspaceId: string;
    sessionId: string;
    guestTokenHash: string;
  }): Promise<string>;
  touchMember(memberId: string, now: Date): Promise<void>;
  /** Atomically increments and returns the next value of a per-branch counter. */
  nextCounter(branchId: string, name: string): Promise<number>;
  findOrderByIdempotencyKey(branchId: string, key: string): Promise<ExistingOrderRef | null>;
  /** Inserts order, lines, add-ons and history. Returns null on an idempotency-key race. */
  insertOrder(input: NewOrderRecord): Promise<string | null>;
  getGuestOrder(
    workspaceId: string,
    sessionId: string,
    memberId: string,
    orderId: string,
  ): Promise<GuestOrderViewDto | null>;
  listGuestOrders(
    workspaceId: string,
    sessionId: string,
    memberId: string,
  ): Promise<GuestOrderViewDto[]>;
  getStaffOrder(target: BranchTarget, orderId: string): Promise<OrderDto | null>;
  findLiveBillForSession(workspaceId: string, sessionId: string): Promise<GuestBillDto | null>;
  /** OPEN → BILL_REQUESTED, version-checked. Returns the updated session or null on a lost race. */
  markBillRequested(session: SessionRecord, now: Date): Promise<SessionRecord | null>;
  loadMenu(target: BranchTarget, options: { includeUnavailable: boolean }): Promise<BranchMenu>;
  notifyBranchStaff(
    target: BranchTarget,
    permission: Permission,
    input: NotificationInput,
  ): Promise<number>;
}

export interface OrderingRepos {
  ordering: OrderingRepository;
  audit: AuditRepository;
}
