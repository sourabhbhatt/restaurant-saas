import { connection } from "next/server";
import { Suspense } from "react";

import { isMeasurementId } from "./gtag";
import { TrackingLoader } from "./tracking-loader";

/**
 * Reads this app's GA4 stream from its runtime environment
 * (GA_MEASUREMENT_ID, per app and per environment; never baked in at build).
 * Unset or malformed: renders nothing, so no banner, no script and no
 * request to Google. `connection()` keeps it out of the static shell.
 */
export async function TrackingConfig() {
  await connection();
  const id = process.env.GA_MEASUREMENT_ID;
  if (!id) return null;
  if (!isMeasurementId(id)) {
    console.warn("GA_MEASUREMENT_ID is not a GA4 Measurement ID (G-XXXXXXX); analytics stays off");
    return null;
  }
  return <TrackingLoader measurementId={id} debug={process.env.GA_DEBUG_MODE === "true"} />;
}

/** Mount once in a root layout. Inert unless GA_MEASUREMENT_ID is set for this app. */
export function Tracking() {
  return (
    <Suspense fallback={null}>
      <TrackingConfig />
    </Suspense>
  );
}
