import type { BillingCycle, SubscriptionStatus } from "../subscriptions/entitlements";

export interface CurrentPeriod {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}

/** One calendar month or year later, in UTC; day-of-month overflow clamps (Jan 31 → Feb 28/29). */
export function addBillingCycle(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (cycle === "ANNUAL") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * The period a paid order buys. When the current paid period (active or
 * cancelled) still runs, the new one starts where it ends; otherwise (trial,
 * expired, none) it starts now. The caller refuses a different plan or cycle
 * while a paid period runs, since the new plan applies immediately.
 */
export function paidPeriodFor(
  current: CurrentPeriod | null,
  cycle: BillingCycle,
  now: Date,
): { start: Date; end: Date } {
  const paidUntil =
    current && (current.status === "ACTIVE" || current.status === "CANCELLED")
      ? current.currentPeriodEnd
      : null;
  const start = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  return { start, end: addBillingCycle(start, cycle) };
}
