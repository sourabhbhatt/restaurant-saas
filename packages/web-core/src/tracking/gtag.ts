/**
 * The Google tag (gtag.js) command queue. Nothing here runs until the visitor
 * opted in: `configureGtag` is the first call that touches `window.dataLayer`,
 * and the script itself is only rendered after it (tracking-client.tsx).
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    /** gtag.js opt-out switch for one stream. */
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

export const GTAG_ORIGIN = "https://www.googletagmanager.com";

/**
 * Hosts gtag.js needs for GA4 without Ads features, per Google's CSP guide
 * (developers.google.com/tag-platform/security/guides/csp).
 */
export const GOOGLE_ANALYTICS_CSP = {
  "script-src": [GTAG_ORIGIN],
  "img-src": [GTAG_ORIGIN, "https://*.google-analytics.com"],
  "connect-src": [GTAG_ORIGIN, "https://*.google-analytics.com", "https://*.google.com"],
} as const;

export function gtagScriptSrc(measurementId: string): string {
  return `${GTAG_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/** GA4 Measurement IDs look like G-XXXXXXXXXX. */
export function isMeasurementId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]{4,20}$/.test(value);
}

let configured: string | null = null;

/** The stream gtag.js was configured for in this document, if any. */
export function configuredMeasurementId(): string | null {
  return configured;
}

function push(...args: unknown[]): void {
  window.gtag?.(...args);
}

const COOKIE_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/**
 * Consent Mode v2 in its basic form: every consent type defaults to denied
 * before any other command; analytics_storage is granted only because this
 * runs after the visitor opted in. Advertising stays denied for good.
 */
export function configureGtag(measurementId: string, options: { debug: boolean }): void {
  window[`ga-disable-${measurementId}`] = false;
  if (configured === measurementId) {
    push("consent", "update", { analytics_storage: "granted" });
    return;
  }
  configured = measurementId;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js reads the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  push("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  push("set", "ads_data_redaction", true);
  push("consent", "update", { analytics_storage: "granted" });
  push("js", new Date());
  push("config", measurementId, {
    // One page_view per route change comes from page-views.ts, never from the tag itself.
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // Host-scoped cookies: the console only, not every subdomain.
    cookie_domain: "none",
    cookie_expires: COOKIE_LIFETIME_SECONDS,
    cookie_flags: window.location.protocol === "https:" ? "SameSite=Lax;Secure" : "SameSite=Lax",
    ...(options.debug ? { debug_mode: true } : {}),
  });
}

/** After a withdrawal: stop every further hit from the already-loaded tag. */
export function disableGtag(measurementId: string): void {
  window[`ga-disable-${measurementId}`] = true;
  if (configured === measurementId) push("consent", "update", { analytics_storage: "denied" });
}

export function gtagEvent(name: string, params: Record<string, unknown>): void {
  if (configured) push("event", name, params);
}

export function gtagSet(params: Record<string, unknown>): void {
  if (configured) push("set", params);
}

/** Tests only. */
export function resetGtagForTests(): void {
  configured = null;
  delete window.gtag;
  delete window.dataLayer;
}
