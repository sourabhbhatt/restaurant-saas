"use client";

import { Info, Megaphone, TriangleAlert, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import type { AnnouncementLevel } from "@/contracts/platform";
import { cn } from "@/lib/utils";

import { usePublicAnnouncements } from "./queries";

const KEY = "ros:dismissed-announcements";
const EVENT = "ros:announcement-dismissed";

function readDismissed(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function useDismissed() {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("storage", cb);
    window.addEventListener(EVENT, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(EVENT, cb);
    };
  }, []);
  const raw = useSyncExternalStore(subscribe, readDismissed, () => "[]");
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    ids = [];
  }
  const dismiss = (id: string) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...ids, id].slice(-50)));
    } catch {
      // Storage unavailable: nothing to persist.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return { ids, dismiss };
}

const STYLE: Record<AnnouncementLevel, string> = {
  INFO: "border-info/20 bg-info/10",
  WARNING: "border-warning/40 bg-warning/15",
  CRITICAL: "border-destructive/30 bg-destructive/10",
};

/**
 * Platform announcements (Super Admin → every signed-in shell). Fetches
 * /public/announcements; INFO and WARNING can be dismissed per announcement,
 * CRITICAL stays until it ends. Renders nothing when there is nothing to say
 * or the request fails (announcements are never critical-path).
 */
export function AnnouncementBar({ className }: { className?: string }) {
  const query = usePublicAnnouncements();
  const { ids, dismiss } = useDismissed();
  const items = (query.data ?? []).filter((a) => a.level === "CRITICAL" || !ids.includes(a.id));
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-col", className)}>
      {items.map((a) => {
        const Icon = a.level === "INFO" ? Info : a.level === "WARNING" ? Megaphone : TriangleAlert;
        return (
          <div
            key={a.id}
            role={a.level === "INFO" ? "status" : "alert"}
            className={cn("border-b px-4 py-2 text-sm", STYLE[a.level])}
          >
            <div className="mx-auto flex max-w-7xl items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <strong className="font-semibold">{a.title}</strong>{" "}
                <span className="text-foreground/80">{a.body}</span>
              </p>
              {a.level !== "CRITICAL" ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="-my-1"
                  aria-label={`Dismiss announcement: ${a.title}`}
                  onClick={() => dismiss(a.id)}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
