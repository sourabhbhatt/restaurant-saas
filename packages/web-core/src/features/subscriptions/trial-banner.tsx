"use client";

import { Clock, ShieldAlert, Sparkles, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@ros/ui/ui/button";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";
import { cn } from "@ros/ui/utils";

import { formatDate } from "./subscription-ui";
import { UpgradeModal } from "./upgrade-modal";

const DISMISS_EVENT = "ros:trial-banner-dismissed";
const storageKey = (workspaceId: string) => `ros:trial-banner:${workspaceId}`;
const today = () => new Date().toISOString().slice(0, 10);

function readDismissed(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(workspaceId));
  } catch {
    return null;
  }
}

/** "Dismissed today" flag in localStorage, safe for SSR and other tabs. */
function useDismissedToday(workspaceId: string) {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("storage", cb);
    window.addEventListener(DISMISS_EVENT, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(DISMISS_EVENT, cb);
    };
  }, []);
  const value = useSyncExternalStore(
    subscribe,
    () => readDismissed(workspaceId),
    () => "ssr",
  );
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey(workspaceId), today());
    } catch {
      // Storage unavailable (private mode): dismiss for this page view only.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, [workspaceId]);
  return { dismissed: value === "ssr" || value === today(), dismiss };
}

type Tone = "info" | "warning" | "danger";
const toneClass: Record<Tone, string> = {
  info: "border-info/20 bg-info/10",
  warning: "border-warning/40 bg-warning/15",
  danger: "border-destructive/25 bg-destructive/10",
};

/**
 * Persistent subscription banner driven by server-computed entitlements.
 * Early in a trial it can be dismissed for the day; near expiry, in grace and
 * when restricted it stays visible. The upgrade CTA opens the upgrade modal.
 */
export function TrialBanner({
  workspaceId,
  entitlements: e,
}: {
  workspaceId: string;
  entitlements: Entitlements;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { dismissed, dismiss } = useDismissedToday(workspaceId);
  const href = `/app/w/${workspaceId}/subscription`;

  let tone: Tone;
  let icon = <Clock className="size-4 shrink-0" aria-hidden />;
  let message: ReactNode;
  let dismissible = false;
  let showUpgrade = true;

  switch (e.phase) {
    case "TRIAL": {
      const days = e.trialDaysRemaining ?? 0;
      dismissible = days > 7;
      tone = dismissible ? "info" : "warning";
      message = (
        <>
          <strong>
            {days} day{days === 1 ? "" : "s"} left
          </strong>{" "}
          in your free trial of {e.planName ?? "the plan"} (ends {formatDate(e.trialEndsAt)}).
        </>
      );
      break;
    }
    case "GRACE":
      tone = "warning";
      icon = <TriangleAlert className="size-4 shrink-0" aria-hidden />;
      message = (
        <>
          <strong>Your trial or subscription has ended.</strong> Daily operations continue until{" "}
          {formatDate(e.graceEndsAt)}; adding restaurants, branches or staff is paused.
        </>
      );
      break;
    case "RESTRICTED":
    case "NONE":
      tone = "danger";
      icon = <ShieldAlert className="size-4 shrink-0" aria-hidden />;
      message =
        e.accessLevel === "NONE" ? (
          <>
            <strong>Access is paused.</strong> Your data is safe — upgrade to restore access.
          </>
        ) : (
          <>
            <strong>The workspace is read-only.</strong> Your data is safe; open bills can still be
            settled. Upgrade to restore full access.
          </>
        );
      break;
    case "SUSPENDED":
    case "DEACTIVATED":
      tone = "danger";
      icon = <ShieldAlert className="size-4 shrink-0" aria-hidden />;
      showUpgrade = false;
      message = (
        <>
          <strong>This workspace is {e.phase.toLowerCase()}.</strong> Your data is retained. Contact
          support to restore access.
        </>
      );
      break;
    default:
      return null;
  }

  if (dismissible && dismissed) return null;

  return (
    <div
      className={cn("border-b px-4 py-2 text-sm", toneClass[tone])}
      role={tone === "info" ? "status" : "alert"}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2">
        {icon}
        <p className="min-w-0 flex-1 text-foreground">{message}</p>
        <div className="flex items-center gap-1">
          {showUpgrade ? (
            <Button size="sm" onClick={() => setUpgradeOpen(true)}>
              <Sparkles aria-hidden /> Upgrade
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/app/w/${workspaceId}/support`}>Contact support</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href={href}>View plan</Link>
          </Button>
          {dismissible ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={dismiss}
              aria-label="Hide trial reminder for today"
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {showUpgrade ? (
        <UpgradeModal workspaceId={workspaceId} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      ) : null}
    </div>
  );
}
