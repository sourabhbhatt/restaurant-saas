import type { BillDto } from "@ros/contracts/billing";
import type {
  BillListItemDto,
  BillListQuery,
  ReceiptDto,
  SessionAwaitingBillDto,
} from "@ros/contracts/billing-extra";
import type { TaxRate } from "@ros/domain/billing/bill-calculator";
import type { BillLine, SnapshotOrder } from "@ros/domain/billing/bill-lines";
import type {
  BillStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
} from "@ros/domain/billing/payments";
import type { SessionStatus } from "@ros/domain/tables/table-status";
import type { AuditRepository } from "../../ports/core-repositories";

/** Tenant coordinates taken from a server-resolved branch scope. */
export interface BranchKey {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

export interface SessionRecord {
  id: string;
  tableId: string;
  tableName: string;
  status: SessionStatus;
  billRequestedAt: Date | null;
  openedAt: Date;
  version: number;
}

export interface BranchBillingSettings {
  taxes: TaxRate[];
  pricesIncludeTax: boolean;
  serviceChargeBps: number;
  paymentMethods: PaymentMethod[];
  requireFullPaymentToClose: boolean;
  autoCompleteOnPayment: boolean;
}

/** The mutable money state of a bill (row locked with FOR UPDATE inside a transaction). */
export interface BillRecord {
  id: string;
  sessionId: string;
  tableId: string;
  billNumber: number;
  status: BillStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  serviceChargeAmount: number;
  taxTotal: number;
  grandTotal: number;
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  itemCount: number;
  version: number;
}

export interface PaymentRecord {
  id: string;
  billId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  status: "CONFIRMED" | "VOIDED";
  idempotencyKey: string;
}

export interface NewBill {
  sessionId: string;
  tableId: string;
  billNumber: number;
  currency: string;
  subtotal: number;
  discount: { type: string; value: number; reason: string | null } | null;
  discountAmount: number;
  serviceChargeBps: number;
  serviceChargeAmount: number;
  pricesIncludeTax: boolean;
  taxBreakdown: { name: string; rateBps: number; amount: number }[];
  taxTotal: number;
  grandTotal: number;
  issuedBy: string;
  issuedAt: Date;
  lines: BillLine[];
}

export interface NewPayment {
  billId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  reference: string | null;
  note: string | null;
  idempotencyKey: string;
  recordedBy: string;
}

export interface PaymentHistoryEntry {
  billId: string;
  paymentId?: string | null;
  action: "RECORDED" | "REFUNDED" | "VOIDED" | "BILL_ISSUED" | "BILL_VOIDED" | "BILL_CLOSED";
  amount?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  paymentStatusAfter?: PaymentStatus | null;
  actorUserId: string | null;
}

export interface BalancePatch {
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
}

export interface PaymentSummaryRow {
  byMethod: { method: PaymentMethod; kind: PaymentKind; total: number }[];
  outstanding: number;
  partiallyPaidBills: number;
  billsIssued: number;
}

export interface BillingRepository {
  /** Branch id owning a bill (unscoped; used only to resolve the access scope). */
  findBillBranchId(billId: string): Promise<string | null>;
  findPaymentBranchId(paymentId: string): Promise<string | null>;

  loadSettings(key: BranchKey): Promise<BranchBillingSettings>;
  findSession(
    key: BranchKey,
    sessionId: string,
    opts?: { lock?: boolean },
  ): Promise<SessionRecord | null>;
  updateSession(
    key: BranchKey,
    sessionId: string,
    expectedVersion: number,
    patch: { status: SessionStatus; closedAt?: Date; closedBy?: string },
  ): Promise<boolean>;
  /** Orders of a session with their item snapshots (and add-on snapshots). */
  listSessionOrders(key: BranchKey, sessionId: string): Promise<SnapshotOrder[]>;
  /** Mark SERVED orders of the session COMPLETED with a SYSTEM history row; returns count. */
  completeServedOrders(
    key: BranchKey,
    sessionId: string,
    at: Date,
    reason: string,
  ): Promise<number>;

  findLiveBillForSession(key: BranchKey, sessionId: string): Promise<BillRecord | null>;
  findBill(key: BranchKey, billId: string, opts?: { lock?: boolean }): Promise<BillRecord | null>;
  nextBillNumber(branchId: string): Promise<number>;
  insertBill(key: BranchKey, bill: NewBill): Promise<string>;
  updateBillBalance(
    key: BranchKey,
    billId: string,
    expectedVersion: number,
    patch: BalancePatch,
  ): Promise<boolean>;
  setBillStatus(
    key: BranchKey,
    billId: string,
    expectedVersion: number,
    patch:
      | { status: "CLOSED"; closedAt: Date }
      | { status: "VOID"; voidedAt: Date; voidedBy: string; voidReason: string },
  ): Promise<boolean>;
  getBillDto(key: BranchKey, billId: string): Promise<BillDto | null>;
  listBills(
    key: BranchKey,
    filter: Omit<BillListQuery, "from" | "to"> & { start?: Date; end?: Date },
  ): Promise<{ items: BillListItemDto[]; total: number }>;
  listOpenBills(key: BranchKey): Promise<BillListItemDto[]>;
  listSessionsAwaitingBill(key: BranchKey): Promise<SessionAwaitingBillDto[]>;
  receiptContext(key: BranchKey): Promise<Omit<ReceiptDto, "bill">>;

  listLedger(billId: string): Promise<PaymentRecord[]>;
  findPaymentByIdempotencyKey(branchId: string, key: string): Promise<PaymentRecord | null>;
  findPayment(key: BranchKey, paymentId: string): Promise<PaymentRecord | null>;
  insertPayment(key: BranchKey, payment: NewPayment): Promise<string>;
  voidPayment(
    key: BranchKey,
    paymentId: string,
    patch: { voidedAt: Date; voidedBy: string; voidReason: string },
  ): Promise<boolean>;
  insertHistory(key: BranchKey, entry: PaymentHistoryEntry): Promise<void>;

  paymentSummary(key: BranchKey, range: { start: Date; end: Date }): Promise<PaymentSummaryRow>;
}

export interface BillingRepos {
  billing: BillingRepository;
  audit: AuditRepository;
}
