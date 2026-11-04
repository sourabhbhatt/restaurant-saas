"use client";

import type { Entitlements } from "@/domain/subscriptions/entitlements";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { TrialBanner } from "@/features/subscriptions/trial-banner";

/**
 * Extension points of the dashboard shells, owned by other features:
 * notifications (bell) and subscriptions (trial / expiry banner).
 */
export const ShellExtras = {
  TopbarActions({ workspaceId }: { workspaceId: string }) {
    return <NotificationBell workspaceId={workspaceId} />;
  },
  Banner({ workspaceId, entitlements }: { workspaceId: string; entitlements: Entitlements }) {
    return <TrialBanner workspaceId={workspaceId} entitlements={entitlements} />;
  },
};
