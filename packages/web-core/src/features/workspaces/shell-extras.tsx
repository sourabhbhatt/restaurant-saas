"use client";

import type { Entitlements } from "@ros/domain/subscriptions/entitlements";
import { AnnouncementBar } from "../superadmin/announcement-bar";
import { NotificationBell } from "../notifications/notification-bell";
import { TrialBanner } from "../subscriptions/trial-banner";

/**
 * Extension points of the dashboard shells, owned by other features:
 * notifications (bell) and subscriptions (trial / expiry banner).
 */
export const ShellExtras = {
  TopbarActions({ workspaceId }: { workspaceId: string }) {
    return <NotificationBell workspaceId={workspaceId} />;
  },
  Banner({ workspaceId, entitlements }: { workspaceId: string; entitlements: Entitlements }) {
    return (
      <>
        <AnnouncementBar />
        <TrialBanner workspaceId={workspaceId} entitlements={entitlements} />
      </>
    );
  },
};
