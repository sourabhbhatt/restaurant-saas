"use client";

import { toast } from "sonner";

import { ApiError } from "@/lib/api-client";

/**
 * Plan limit / missing feature errors (402) get a toast with a link to the
 * subscription page. Returns true when handled.
 */
export function handlePlanError(
  error: unknown,
  workspaceId: string,
  navigate: (href: string) => void,
): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code !== "LIMIT_REACHED" && error.code !== "ENTITLEMENT_REQUIRED") return false;
  toast.error(error.message, {
    description: "Upgrade your plan to add more.",
    action: {
      label: "View plans",
      onClick: () => navigate(`/app/w/${workspaceId}/subscription`),
    },
  });
  return true;
}
