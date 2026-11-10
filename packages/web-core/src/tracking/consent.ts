"use client";

import { create } from "zustand";

import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_MAX_AGE_SECONDS,
} from "@ros/contracts/tracking-events";

export type ConsentChoice = "granted" | "denied";

export interface TrackingState {
  /** The GA4 web stream for this app and environment; null = not configured, everything inert. */
  measurementId: string | null;
  /** GA4 DebugView (staging only). */
  debug: boolean;
  /** The visitor's stored choice; null until they make one. */
  consent: ConsentChoice | null;
  /** The banner was reopened from the footer link. */
  settingsOpen: boolean;
}

export const useTrackingStore = create<TrackingState>(() => ({
  measurementId: null,
  debug: false,
  consent: null,
  settingsOpen: false,
}));

export function readConsentCookie(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === ANALYTICS_CONSENT_COOKIE && (value === "granted" || value === "denied"))
      return value;
  }
  return null;
}

function writeConsentCookie(choice: ConsentChoice): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Deletes the GA cookies (`_ga`, `_ga_<container>`) on this host and every
 * parent domain, since gtag.js may have set them with a Domain attribute.
 */
export function clearAnalyticsCookies(): void {
  if (typeof document === "undefined") return;
  const names = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0]!)
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  if (!names.length) return;
  const labels = window.location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i++) domains.push(`; Domain=${labels.slice(i).join(".")}`);
  for (const name of names)
    for (const domain of domains)
      document.cookie = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${domain}`;
}

/** The visitor's choice from the banner. Stored for 180 days; asked again after that. */
export function chooseAnalytics(choice: ConsentChoice): void {
  writeConsentCookie(choice);
  if (choice === "denied") clearAnalyticsCookies();
  useTrackingStore.setState({ consent: choice, settingsOpen: false });
}

/** "Cookie settings" in the footer: show the banner again with the current choice. */
export function openPrivacyChoices(): void {
  useTrackingStore.setState({ settingsOpen: true });
}
