"use client";

import { Cookie } from "lucide-react";

import { DropdownMenuItem } from "@ros/ui/ui/dropdown-menu";

import { openPrivacyChoices, useTrackingStore } from "./consent";

let closedByPrivacyChoices = false;

/**
 * "Cookie settings" as an item of the account menu (every dashboard and the
 * account page). Renders nothing when analytics is not configured.
 */
export function PrivacyChoicesMenuItem() {
  const configured = useTrackingStore((s) => s.measurementId !== null);
  if (!configured) return null;
  return (
    <DropdownMenuItem
      onSelect={() => {
        closedByPrivacyChoices = true;
        openPrivacyChoices();
      }}
    >
      <Cookie className="size-4" aria-hidden /> Cookie settings
    </DropdownMenuItem>
  );
}

/**
 * The account menu's `onCloseAutoFocus`: when "Cookie settings" closed it, the
 * menu does not pull focus back to its trigger, so it stays on the banner.
 */
export function keepFocusOnPrivacyChoices(event: Event): void {
  if (closedByPrivacyChoices) event.preventDefault();
  closedByPrivacyChoices = false;
}
