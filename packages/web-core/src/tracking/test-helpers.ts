import { ANALYTICS_CONSENT_COOKIE } from "@ros/contracts/tracking-events";

import { useTrackingStore } from "./consent";
import { resetGtagForTests } from "./gtag";
import { resetPageViewsForTests } from "./page-views";
import { resetTrackOnceForTests } from "./track";

export const TEST_ID = "G-TEST1234";

/** The gtag commands queued so far, as plain arrays (gtag pushes `arguments` objects). */
export function commands(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

export function events(name?: string): { name: string; params: Record<string, unknown> }[] {
  return commands()
    .filter((c) => c[0] === "event" && (!name || c[1] === name))
    .map((c) => ({ name: c[1] as string, params: c[2] as Record<string, unknown> }));
}

export function setPath(path: string): void {
  window.history.replaceState({}, "", path);
}

export function setConsentCookie(value: "granted" | "denied"): void {
  document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${value}; Path=/`;
}

export function resetTracking(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.trim().split("=")[0];
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
  window.sessionStorage.clear();
  useTrackingStore.setState({
    measurementId: null,
    debug: false,
    consent: null,
    settingsOpen: false,
  });
  resetGtagForTests();
  resetPageViewsForTests();
  resetTrackOnceForTests();
  delete window[`ga-disable-${TEST_ID}`];
  setPath("/");
}
