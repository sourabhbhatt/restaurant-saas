/**
 * First-party cookie holding the visitor's analytics choice (`granted` or
 * `denied`). Not HttpOnly: the browser reads it to decide whether to load
 * gtag.js; the API reads it before using the GA client id for attribution.
 * Its own module: the site footer's "Cookie settings" needs only these two
 * values on every page, not the event catalog (tracking-events.ts re-exports them).
 */
export const ANALYTICS_CONSENT_COOKIE = "ros_analytics_consent";
/** The choice is asked again after 180 days. GA cookies use the same lifetime. */
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
