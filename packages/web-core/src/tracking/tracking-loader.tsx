"use client";

import dynamic from "next/dynamic";

/**
 * The tracker's code is a separate chunk, fetched only when this renders,
 * i.e. only when the app has a Measurement ID (tracking.tsx). Every console
 * page, the marketing site included, otherwise carries none of it in its
 * first-load JavaScript. Client-only: the banner never renders on the server.
 */
const TrackingClient = dynamic(() => import("./tracking-client").then((m) => m.TrackingClient), {
  ssr: false,
});

export function TrackingLoader(props: { measurementId: string; debug: boolean }) {
  return <TrackingClient {...props} />;
}
