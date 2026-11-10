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
  { route: "/tables/:id/qr", emit: () => track("qr_generated") },
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
