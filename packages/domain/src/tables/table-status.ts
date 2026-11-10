/**
 * Table and table-session states. A table's displayed status is derived from
 * its active session and that session's bill, so it cannot drift out of sync.
 */
export const TABLE_STATUSES = [
  "AVAILABLE",
  "OCCUPIED",
  "BILL_REQUESTED",
  "BILL_GENERATED",
  "PAYMENT_PENDING",
  "CLOSED",
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const SESSION_STATUSES = ["OPEN", "BILL_REQUESTED", "BILLED", "CLOSED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface TableStatusInput {
  /** Table disabled by a manager (out of service). */
  isActive: boolean;
  session: { status: SessionStatus } | null;
  bill: { paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED" } | null;
}

export function deriveTableStatus(input: TableStatusInput): TableStatus {
  if (!input.isActive) return "CLOSED";
  const { session, bill } = input;
  if (!session || session.status === "CLOSED") return "AVAILABLE";
  if (session.status === "BILLED" && bill) {
    return bill.paymentStatus === "PARTIALLY_PAID" ? "PAYMENT_PENDING" : "BILL_GENERATED";
  }
  if (session.status === "BILL_REQUESTED") return "BILL_REQUESTED";
  return "OCCUPIED";
}

export interface ClosureRules {
  /** Bill must be fully paid before the session can close. */
  requireFullPayment: boolean;
}

export interface ClosureState {
  activeOrderCount: number;
  /** Orders still PENDING (customer awaiting approval). */
  pendingOrderCount: number;
  /** Orders ACCEPTED, PREPARING or READY: in the kitchen or waiting to be served. */
  inKitchenOrderCount: number;
  hasBillableOrders: boolean;
  bill: { balanceDue: number; status: "ISSUED" | "CLOSED" | "VOID" } | null;
}

/** Machine-readable reasons a session cannot close, for clients and the 409 body. */
export type ClosureBlocker = "PENDING_ORDERS" | "ORDERS_IN_KITCHEN" | "NO_BILL" | "BALANCE_DUE";

export interface ClosureCheck {
  allowed: boolean;
  reasons: string[];
  blockers: ClosureBlocker[];
}

/**
 * Can a table session be closed under the branch's closure rules?
 *
 * Every order must be settled first: pending ones decided, kitchen ones served
 * (or cancelled). Closing around an order that is still being prepared would
 * strand it: the kitchen display lists orders by status, not by session, and
 * nothing would ever serve or complete it. Billable orders need a live bill;
 * whether an outstanding balance may stay open is the branch's own rule
 * (`requireFullPayment`), and a close with a balance is audited as such.
 */
export function checkSessionClosure(state: ClosureState, rules: ClosureRules): ClosureCheck {
  const found: { blocker: ClosureBlocker; reason: string }[] = [];
  if (state.pendingOrderCount > 0) {
    found.push({ blocker: "PENDING_ORDERS", reason: "Approve or reject pending orders first" });
  }
  if (state.inKitchenOrderCount > 0) {
    found.push({
      blocker: "ORDERS_IN_KITCHEN",
      reason: "Serve or cancel the orders still in the kitchen first",
    });
  }
  if (state.hasBillableOrders) {
    const bill = state.bill && state.bill.status !== "VOID" ? state.bill : null;
    if (!bill) found.push({ blocker: "NO_BILL", reason: "Generate the bill before closing" });
    else if (rules.requireFullPayment && bill.balanceDue > 0) {
      found.push({ blocker: "BALANCE_DUE", reason: "The bill has an outstanding balance" });
    }
  }
  return {
    allowed: found.length === 0,
    reasons: found.map((f) => f.reason),
    blockers: found.map((f) => f.blocker),
  };
}
