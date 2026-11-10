"use client";

import { openPrivacyChoices, useTrackingStore } from "./consent";

/**
 * "Cookie settings" reopens the analytics choice. It sits wherever the banner
 * can be accepted: the site footer and the auth pages' footer here, the
 * account menu in privacy-choices-menu.tsx (kept apart so the footers of
 * every page do not load the dropdown menu). Renders nothing when analytics
 * is not configured (ops, admin, any environment without a Measurement ID).
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
