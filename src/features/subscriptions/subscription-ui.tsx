import type { StatusTone } from "@/components/shared/feedback";
import { formatMoney } from "@/domain/shared/money";
import {
  limitLabel,
  type LimitKey,
  type SubscriptionPhase,
} from "@/domain/subscriptions/entitlements";

/** Display helpers shared by the subscription, upgrade and Super Admin screens. */

export const PHASE_LABEL: Record<SubscriptionPhase, string> = {
  TRIAL: "Free trial",
  ACTIVE: "Active",
  GRACE: "Grace period",
  RESTRICTED: "Restricted",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
  NONE: "No plan",
};

export const PHASE_TONE: Record<SubscriptionPhase, StatusTone> = {
  TRIAL: "info",
  ACTIVE: "success",
  GRACE: "warning",
  RESTRICTED: "danger",
  SUSPENDED: "danger",
  DEACTIVATED: "neutral",
  NONE: "neutral",
};

export const LIMIT_TITLES: Record<LimitKey, string> = {
  maxRestaurants: "Restaurants",
  maxBranches: "Branches",
  maxStaff: "Staff members",
  maxTables: "Tables",
  maxMenuItems: "Menu items",
  storageMb: "Storage",
};

export function formatLimit(key: LimitKey, value: number | null): string {
  if (value === null) return "Unlimited";
  if (key === "storageMb") return value >= 1000 ? `${(value / 1000).toFixed(1)} GB` : `${value} MB`;
  return `${value.toLocaleString("en-IN")} ${limitLabel(key)}`;
}

export function formatPrice(minor: number | null, currency: string): string {
  if (minor === null) return "Custom pricing";
  if (minor === 0) return "Free";
  return formatMoney(minor, currency);
}

/** Dates arrive from JSON as ISO strings even where the shared type says Date. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

const EVENT_LABELS: Record<string, string> = {
  trial_started: "Trial started",
  activated: "Subscription activated",
  paid: "Payment received",
  trial_extended: "Trial extended",
  cancelled: "Subscription cancelled",
  expired: "Subscription expired",
  trial_reminder_sent: "Trial reminder sent",
  trial_ended: "Trial ended",
  period_ended: "Billing period ended",
  grace_ended: "Grace period ended",
  override_set: "Entitlement override set",
  override_removed: "Entitlement override removed",
  workspace_active: "Workspace reactivated",
  workspace_suspended: "Workspace suspended",
  workspace_deactivated: "Workspace deactivated",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export function eventTone(type: string): StatusTone {
  if (
    type === "activated" ||
    type === "paid" ||
    type === "workspace_active" ||
    type === "trial_extended"
  )
    return "success";
  if (type.includes("expired") || type.includes("ended") || type === "workspace_suspended")
    return "danger";
  if (type === "cancelled" || type === "workspace_deactivated") return "warning";
  if (type.startsWith("trial")) return "info";
  return "neutral";
}
