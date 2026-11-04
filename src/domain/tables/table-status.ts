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
  hasBillableOrders: boolean;
  bill: { balanceDue: number; status: "ISSUED" | "CLOSED" | "VOID" } | null;
}

export interface ClosureCheck {
  allowed: boolean;
  reasons: string[];
}

/** Can a table session be closed under the branch's closure rules? */
export function checkSessionClosure(state: ClosureState, rules: ClosureRules): ClosureCheck {
  const reasons: string[] = [];
  if (state.pendingOrderCount > 0) {
    reasons.push("Approve or reject pending orders first");
  }
  const unfinished = state.activeOrderCount - state.pendingOrderCount;
  if (state.hasBillableOrders) {
    const bill = state.bill && state.bill.status !== "VOID" ? state.bill : null;
    if (!bill) reasons.push("Generate the bill before closing");
    else if (rules.requireFullPayment && bill.balanceDue > 0) {
      reasons.push("The bill has an outstanding balance");
    }
  } else if (unfinished > 0) {
    reasons.push("There are orders still in progress");
  }
  return { allowed: reasons.length === 0, reasons };
}
