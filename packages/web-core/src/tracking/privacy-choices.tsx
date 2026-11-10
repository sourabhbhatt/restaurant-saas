"use client";

import { openPrivacyChoices, useTrackingStore } from "./consent";

/** Footer link that reopens the analytics choice. Renders nothing when analytics is not configured. */
export function PrivacyChoicesLink({ className }: { className?: string }) {
  const configured = useTrackingStore((s) => s.measurementId !== null);
  if (!configured) return null;
  return (
    <button type="button" onClick={openPrivacyChoices} className={className}>
      Cookie settings
    </button>
  );
}
