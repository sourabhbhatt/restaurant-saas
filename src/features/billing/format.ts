import type { StatusTone } from "@/components/shared/feedback";
import type { BillStatus, PaymentMethod, PaymentStatus } from "@/domain/billing/payments";
import { formatMoney } from "@/domain/shared/money";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  UNPAID: "warning",
  PARTIALLY_PAID: "info",
  PAID: "success",
  REFUNDED: "neutral",
};

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  ISSUED: "Open",
  CLOSED: "Closed",
  VOID: "Void",
};

export const BILL_STATUS_TONE: Record<BillStatus, StatusTone> = {
  ISSUED: "info",
  CLOSED: "neutral",
  VOID: "danger",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};

export const money = (minor: number, currency: string) => formatMoney(minor, currency);

/** "4 Nov 2026, 7:42 pm" in the branch timezone. */
export function formatDateTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function formatTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

/** "12 min", "2 h 5 min" since `iso`. */
export function ageLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}

export const bpsLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

/** Major-unit text (e.g. "125.50") → minor units; null when not a valid amount. */
export function parseMajor(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const toMajorText = (minor: number) => (minor / 100).toFixed(2);
