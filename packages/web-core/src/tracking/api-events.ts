"use client";

import { onApiSuccess, type ApiSuccess } from "@ros/api-client";
import { majorUnits, trackingBillingCycle } from "@ros/contracts/tracking-events";

import { track } from "./track";

/** Sign-up from an invitation link (`/sign-up?next=/invite/…`): a teammate, not a new customer. */
function invitedSignUp(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("next")?.startsWith("/invite/") ?? false;
  } catch {
    return false;
  }
}

function checkoutParams(data: unknown) {
  const d = data as {
    planKey?: unknown;
    billingCycle?: unknown;
    amountMinor?: unknown;
    currency?: unknown;
  } | null;
  if (
    !d ||
    typeof d.planKey !== "string" ||
    (d.billingCycle !== "MONTHLY" && d.billingCycle !== "ANNUAL") ||
    typeof d.amountMinor !== "number" ||
    typeof d.currency !== "string"
  )
    return null;
  return {
    plan_key: d.planKey,
    billing_cycle: trackingBillingCycle(d.billingCycle),
    value: majorUnits(d.amountMinor, d.currency),
    currency: d.currency,
  };
}

/** API-confirmed events counted once per user action, however many requests it takes. */
type PerActionEvent = "qr_generated";

/** Open bulk actions: how many requests the API accepted so far in each. */
const openActions = new Map<PerActionEvent, number>();

function countAccepted(name: PerActionEvent): void {
  const open = openActions.get(name);
  if (open !== undefined) openActions.set(name, open + 1);
  else track(name, { count: 1 });
}

/**
 * Runs a bulk user action (onboarding creating every table's QR code, the
 * print sheet's "Generate missing") as ONE event: each accepted request inside
 * `fn` is counted, and a single `name` event with `count` is sent when it ends,
 * or nothing if none was accepted. A nested call joins the outer action.
 * `qr_generated` is a GA4 key event, so ten tables must not be ten conversions.
 */
export async function asOneAction<T>(name: PerActionEvent, fn: () => Promise<T>): Promise<T> {
  if (openActions.has(name)) return fn();
  openActions.set(name, 0);
  try {
    return await fn();
  } finally {
    const count = openActions.get(name) ?? 0;
    openActions.delete(name);
    if (count > 0) track(name, { count: Math.min(count, 1000) });
  }
}

/**
 * Product events confirmed by the server: each fires when the API accepted
 * the mutation (2xx), whichever screen sent it (dialog, onboarding wizard, a
 * later screen). Templates are API paths under /api/v1; `:id` is any segment.
 * The response body is only read for the checkout's plan and price.
 */
export const API_EVENT_RULES: readonly { route: string; emit: (data: unknown) => void }[] = [
  {
    route: "/auth/signup",
    emit: () => track("signup_completed", { method: "password", invited: invitedSignUp() }),
  },
  { route: "/auth/signin", emit: () => track("login_completed", { method: "password" }) },
  { route: "/workspaces", emit: () => track("workspace_created") },
  { route: "/workspaces/:id/restaurants", emit: () => track("restaurant_created") },
  { route: "/restaurants/:id/branches", emit: () => track("branch_created") },
  { route: "/restaurants/:id/menu/items", emit: () => track("menu_item_created") },
  { route: "/tables/:id/qr", emit: () => countAccepted("qr_generated") },
  {
    route: "/organizations/:id/checkout",
    emit: (data) => {
      const params = checkoutParams(data);
      if (params) track("checkout_started", params);
    },
  },
];

const compiled = API_EVENT_RULES.map((rule) => ({
  pattern: new RegExp(`^/api/v1${rule.route.replaceAll(":id", "[^/]+")}$`),
  emit: rule.emit,
}));

export function handleApiSuccess({ method, url, data }: ApiSuccess): void {
  if (method !== "POST") return;
  const path = url.split("?")[0]!;
  compiled.find((rule) => rule.pattern.test(path))?.emit(data);
}

/** Subscribes to accepted API mutations; returns the unsubscribe function. */
export function startApiTracking(): () => void {
  return onApiSuccess(handleApiSuccess);
}
