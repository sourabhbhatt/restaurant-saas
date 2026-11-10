"use client";

import { Cookie } from "lucide-react";

import { DropdownMenuItem } from "@ros/ui/ui/dropdown-menu";

import { openPrivacyChoices, useTrackingStore } from "./consent";

/**
 * "Cookie settings" reopens the analytics choice. It sits wherever the banner
 * can be accepted: the site footer, the auth pages' footer and the account
 * menu. Renders nothing when analytics is not configured (ops, admin, any
 * environment without a Measurement ID).
 */
export function PrivacyChoicesLink({ className }: { className?: string }) {
  const configured = useTrackingStore((s) => s.measurementId !== null);
  if (!configured) return null;
  return (
    <button type="button" onClick={openPrivacyChoices} className={className}>
      Cookie settings
    </button>
  );
}

/** The same control as an item of the account menu (dashboards and the account page). */
export function PrivacyChoicesMenuItem() {
  const configured = useTrackingStore((s) => s.measurementId !== null);
  if (!configured) return null;
  return (
    <DropdownMenuItem onSelect={openPrivacyChoices}>
      <Cookie className="size-4" aria-hidden /> Cookie settings
    </DropdownMenuItem>
  );
}
