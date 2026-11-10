"use client";

import { gtagEvent, gtagSet } from "./gtag";
import { contentGroupFor, sanitizePath, sanitizeReferrer, sanitizeUrl } from "./sanitize";
import { track, trackingActive } from "./track";

const LANDING_KEY = "ros_tracking_landing";

let lastPathname: string | null = null;
let previousLocation: string | null = null;

function firstPageOfSession(): boolean {
  try {
    if (window.sessionStorage.getItem(LANDING_KEY)) return false;
    window.sessionStorage.setItem(LANDING_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends exactly one GA4 `page_view` per route change. gtag's automatic page
 * view is off (`send_page_view: false`) and the GA4 stream's enhanced
 * measurement must be off too (docs list the setting), so this is the only
 * source. A repeat for the same pathname (React Strict Mode effects, a
 * re-render, a query-string change) is ignored. Returns whether it sent.
 */
export function trackPageView(pathname: string): boolean {
  if (!trackingActive() || pathname === lastPathname) return false;
  const group = contentGroupFor(pathname);
  if (group === null) return false;
  lastPathname = pathname;

  const pageLocation = sanitizeUrl(window.location.href);
  const pagePath = sanitizePath(pathname);
  const pageReferrer =
    previousLocation ?? sanitizeReferrer(document.referrer, window.location.origin);
  const page = {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    // Never document.title: app titles can name a restaurant, and on a client navigation the
    // previous route's title can still be showing. The sanitized path stands in for it.
    page_title: pagePath,
    content_group: group,
  };
  // Later events on this page (sign-up, checkout, ...) carry the same sanitized page fields.
  gtagSet(page);
  gtagEvent("page_view", page);
  previousLocation = pageLocation;

  if (firstPageOfSession() && group === "marketing")
    track("landing_page_view", { landing_page: pagePath });
  return true;
}

/** Tests only. */
export function resetPageViewsForTests(): void {
  lastPathname = null;
  previousLocation = null;
}
