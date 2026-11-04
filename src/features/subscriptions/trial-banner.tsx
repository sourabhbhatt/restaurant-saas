"use client";

import Link from "next/link";

import type { Entitlements } from "@/domain/subscriptions/entitlements";

/** Persistent trial / expiry banner driven entirely by server-computed entitlements. */
export function TrialBanner({
  workspaceId,
  entitlements: e,
}: {
  workspaceId: string;
  entitlements: Entitlements;
}) {
  const href = `/app/w/${workspaceId}/subscription`;
  if (e.phase === "TRIAL") {
    return (
      <div
        className="border-b bg-info/10 px-4 py-2 text-center text-sm text-info-foreground"
        role="status"
      >
        <span className="text-foreground">
          Free trial: <strong>{e.trialDaysRemaining} days left</strong> on {e.planName}.
        </span>{" "}
        <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
          View plans
        </Link>
      </div>
    );
  }
  if (e.phase === "GRACE" || e.phase === "RESTRICTED" || e.phase === "NONE") {
    const msg =
      e.phase === "GRACE"
        ? "Your trial or subscription has ended. You're in the grace period — upgrade to keep adding restaurants, branches and staff."
        : "Your subscription has expired. The workspace is read-only; your data is safe.";
    return (
      <div className="border-b bg-warning/15 px-4 py-2 text-center text-sm" role="alert">
        {msg}{" "}
        <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
          Reactivate
        </Link>
      </div>
    );
  }
  if (e.phase === "SUSPENDED" || e.phase === "DEACTIVATED") {
    return (
      <div className="border-b bg-destructive/10 px-4 py-2 text-center text-sm" role="alert">
        This workspace is {e.phase.toLowerCase()}. Contact support to restore access.
      </div>
    );
  }
  return null;
}
