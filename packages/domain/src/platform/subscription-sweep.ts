import {
  addDays,
  daysRemaining,
  dueTrialReminders,
  type SubscriptionStatus,
} from "../subscriptions/entitlements";

/**
 * Pure decisions for the scheduled subscription sweep and Super Admin
 * subscription actions. The sweep never changes access (status is computed
 * from dates at read time); it only decides which one-time notifications are
 * due. "Already sent" markers live in `subscriptions.reminders_sent`: positive
 * numbers are trial reminder days, negative sentinels mark one-time events.
 */
export const SWEEP_SENTINELS = {
  TRIAL_EXPIRED: -1,
  PERIOD_EXPIRED: -2,
  GRACE_ENDED: -3,
} as const;

export interface SweepSubscription {
  status: SubscriptionStatus;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  remindersSent: readonly number[];
}

export interface SweepPolicy {
  trialReminderDays: readonly number[];
  graceDays: number;
}

export interface SweepDecision {
  /** Reminder to send now (the latest due day), or null. */
  reminderDay: number | null;
  /** Whole days left in the trial when a reminder is sent. */
  trialDaysLeft: number | null;
  trialExpired: boolean;
  periodExpired: boolean;
  graceEnded: boolean;
  /** New value for reminders_sent (unchanged when nothing is due). */
  nextRemindersSent: number[];
  changed: boolean;
}

export function planSubscriptionSweep(
  sub: SweepSubscription,
  policy: SweepPolicy,
  now: Date,
): SweepDecision {
  const sent = new Set(sub.remindersSent);
  const add: number[] = [];
  let reminderDay: number | null = null;
  let trialDaysLeft: number | null = null;
  let trialExpired = false;
  let periodExpired = false;
  let graceEnded = false;

  const endOfAccess =
    sub.status === "TRIALING"
      ? sub.trialEndsAt
      : sub.status === "ACTIVE" || sub.status === "CANCELLED"
        ? sub.currentPeriodEnd
        : null;

  if (sub.status === "TRIALING" && sub.trialStartsAt && sub.trialEndsAt) {
    const due = dueTrialReminders(
      sub.trialStartsAt,
      policy.trialReminderDays,
      [...sent].filter((d) => d > 0),
      now,
    );
    const ended = now.getTime() >= sub.trialEndsAt.getTime();
    // Mark every due day as handled; when the job was down for a while only
    // the most recent reminder is sent, and none once the trial is over.
    add.push(...due);
    if (!ended && due.length) {
      reminderDay = Math.max(...due);
      trialDaysLeft = daysRemaining(sub.trialEndsAt, now);
    }
    if (ended && !sent.has(SWEEP_SENTINELS.TRIAL_EXPIRED)) {
      trialExpired = true;
      add.push(SWEEP_SENTINELS.TRIAL_EXPIRED);
    }
  }

  if (
    (sub.status === "ACTIVE" || sub.status === "CANCELLED") &&
    sub.currentPeriodEnd &&
    now.getTime() >= sub.currentPeriodEnd.getTime() &&
    !sent.has(SWEEP_SENTINELS.PERIOD_EXPIRED)
  ) {
    periodExpired = true;
    add.push(SWEEP_SENTINELS.PERIOD_EXPIRED);
  }

  if (
    endOfAccess &&
    now.getTime() >= addDays(endOfAccess, policy.graceDays).getTime() &&
    !sent.has(SWEEP_SENTINELS.GRACE_ENDED)
  ) {
    graceEnded = true;
    add.push(SWEEP_SENTINELS.GRACE_ENDED);
  }

  const next = [...sub.remindersSent];
  for (const d of add) if (!next.includes(d)) next.push(d);
  return {
    reminderDay,
    trialDaysLeft,
    trialExpired,
    periodExpired,
    graceEnded,
    nextRemindersSent: next,
    changed: next.length !== sub.remindersSent.length,
  };
}

/**
 * New trial end when a Super Admin extends a trial by `days`: counted from the
 * current end, or from now if the trial already ended (so the workspace
 * really gets `days` more days).
 */
export function extendedTrialEnd(trialEndsAt: Date | null, now: Date, days: number): Date {
  const base = trialEndsAt && trialEndsAt.getTime() > now.getTime() ? trialEndsAt : now;
  return addDays(base, days);
}

/**
 * Markers to keep after a trial extension: reminder days already sent stay
 * sent, but the one-time "trial ended" / "grace ended" notices can fire again
 * when the extended trial ends.
 */
export function remindersAfterExtension(sent: readonly number[]): number[] {
  return sent.filter(
    (d) => d !== SWEEP_SENTINELS.TRIAL_EXPIRED && d !== SWEEP_SENTINELS.GRACE_ENDED,
  );
}

/** "YYYY-MM-DD" (inclusive last day of the paid period) → end of that day, UTC. */
export function periodEndFromDate(date: string): Date {
  const d = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  return d;
}
