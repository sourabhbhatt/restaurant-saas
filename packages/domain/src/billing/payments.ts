import { DomainError } from "../shared/errors";
import { assertMinorUnits } from "../shared/money";

export const PAYMENT_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BILL_STATUSES = ["ISSUED", "CLOSED", "VOID"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** Built-in payment methods; branches enable a subset and may add "OTHER". */
export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_KINDS = ["PAYMENT", "REFUND"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface LedgerEntry {
  kind: PaymentKind;
  amount: number;
  /** Voided entries are kept for audit but do not count. */
  voided?: boolean;
}

export interface BillBalance {
  amountPaid: number;
  amountRefunded: number;
  netPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
}

/** Derive the payment state of a bill from its ledger. Never stored from client input. */
export function computeBalance(grandTotal: number, ledger: readonly LedgerEntry[]): BillBalance {
  let amountPaid = 0;
  let amountRefunded = 0;
  for (const entry of ledger) {
    if (entry.voided) continue;
    assertMinorUnits(entry.amount);
    if (entry.kind === "PAYMENT") amountPaid += entry.amount;
    else amountRefunded += entry.amount;
  }
  const netPaid = amountPaid - amountRefunded;
  const balanceDue = Math.max(grandTotal - netPaid, 0);
  let paymentStatus: PaymentStatus;
  if (amountRefunded > 0 && netPaid <= 0) paymentStatus = "REFUNDED";
  else if (netPaid >= grandTotal && grandTotal >= 0 && (netPaid > 0 || grandTotal === 0))
    paymentStatus = "PAID";
  else if (netPaid > 0) paymentStatus = "PARTIALLY_PAID";
  else paymentStatus = "UNPAID";
  return { amountPaid, amountRefunded, netPaid, balanceDue, paymentStatus };
}

/** Validate a new payment against the current balance. Overpayment is rejected. */
export function assertPaymentAllowed(balance: BillBalance, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DomainError("VALIDATION_FAILED", "Payment amount must be greater than zero", {
      fieldErrors: { amount: ["Enter an amount greater than zero"] },
    });
  }
  if (balance.balanceDue === 0) {
    throw new DomainError("PAYMENT_REJECTED", "This bill is already fully paid");
  }
  if (amount > balance.balanceDue) {
    throw new DomainError("PAYMENT_REJECTED", "Amount exceeds the outstanding balance", {
      fieldErrors: { amount: ["Amount exceeds the outstanding balance"] },
      details: { balanceDue: balance.balanceDue },
    });
  }
}

export function assertRefundAllowed(balance: BillBalance, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DomainError("VALIDATION_FAILED", "Refund amount must be greater than zero", {
      fieldErrors: { amount: ["Enter an amount greater than zero"] },
    });
  }
  if (amount > balance.netPaid) {
    throw new DomainError("PAYMENT_REJECTED", "Refund exceeds the amount paid", {
      fieldErrors: { amount: ["Refund exceeds the amount paid"] },
    });
  }
}

/** Change to return for a cash tender. */
export function cashChange(tendered: number, applied: number): number {
  return Math.max(tendered - applied, 0);
}
