"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { startApiTracking } from "./api-events";
import { ConsentBanner } from "./consent-banner";
import {
  CONSENT_CHANNEL,
  clearAnalyticsCookies,
  readConsentCookie,
  syncConsentFromCookie,
  useTrackingStore,
} from "./consent";
import { configureGtag, disableGtag, gtagScriptSrc } from "./gtag";
import { trackPageView } from "./page-views";
import { contentGroupFor } from "./sanitize";

/**
 * Rendered only when a Measurement ID is configured (tracking.tsx). Shows the
 * opt-in banner, loads gtag.js only after "Allow", and sends one page_view
 * per route change. Guest QR pages, print sheets and dev tools never show
 * the banner or load the tag.
 */
export function TrackingClient({
  measurementId,
  debug,
}: {
  measurementId: string;
  debug: boolean;
}) {
  const pathname = usePathname();
  const ready = useTrackingStore((s) => s.measurementId === measurementId);
  const consent = useTrackingStore((s) => s.consent);
  const settingsOpen = useTrackingStore((s) => s.settingsOpen);
  const measured = contentGroupFor(pathname) !== null;
  const granted = ready && consent === "granted";

  useEffect(() => {
    useTrackingStore.setState({ measurementId, debug, consent: readConsentCookie() });
    return () => useTrackingStore.setState({ measurementId: null });
  }, [measurementId, debug]);

  useEffect(() => {
    if (!ready) return;
    if (granted && measured) configureGtag(measurementId, { debug });
    // A client navigation from a measured page to a guest QR page or a print sheet: the tag
    // is already loaded, so switch it off there (configureGtag re-enables it on the way back).
    // Our own code sends nothing on these routes; this keeps gtag.js itself quiet too.
    if (granted && !measured) disableGtag(measurementId);
    if (!granted) {
      disableGtag(measurementId);
      clearAnalyticsCookies();
    }
  }, [ready, granted, measured, measurementId, debug]);

  useEffect(() => {
    if (granted) trackPageView(pathname);
  }, [granted, pathname]);

  // A choice made in another tab: told at once (BroadcastChannel), re-checked when shown.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CONSENT_CHANNEL);
      channel.onmessage = syncConsentFromCookie;
    } catch {
      channel = null;
    }
    document.addEventListener("visibilitychange", syncConsentFromCookie);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", syncConsentFromCookie);
    };
  }, []);

  useEffect(() => startApiTracking(), []);

  return (
    <>
      {granted && measured ? (
        <Script id="ga4-gtag" src={gtagScriptSrc(measurementId)} strategy="afterInteractive" />
      ) : null}
      {ready && measured && (consent === null || settingsOpen) ? (
        <ConsentBanner current={consent} takeFocus={settingsOpen} />
      ) : null}
    </>
  );
}
