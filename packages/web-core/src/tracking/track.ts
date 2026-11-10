"use client";

import { useEffect, useRef } from "react";

import {
  validateTrackingEvent,
  type ClientEventName,
  type TrackingParams,
} from "@ros/contracts/tracking-events";

import { readConsentCookie, useTrackingStore } from "./consent";
import { configuredMeasurementId, gtagEvent } from "./gtag";
import { contentGroupFor } from "./sanitize";

type ParamsArg<E extends ClientEventName> =
  Record<string, never> extends TrackingParams<E>
    ? [params?: TrackingParams<E>]
    : [params: TrackingParams<E>];

/**
 * True only when a Measurement ID is configured, the visitor opted in and gtag
 * is set up. The cookie is checked too, so a withdrawal made in another tab
 * stops this tab's events before it has even heard about it.
 */
export function trackingActive(): boolean {
  const { measurementId, consent } = useTrackingStore.getState();
  return (
    Boolean(measurementId) &&
    consent === "granted" &&
    configuredMeasurementId() === measurementId &&
    readConsentCookie() === "granted"
  );
}

/**
 * The only way the browser sends a growth event. The name must be in the
 * shared catalog and the params must match its strict schema, so personal
 * data does not type-check; anything that slips past the types is dropped by
 * the runtime check. A no-op without a Measurement ID or without consent,
 * and on routes that are never measured (guest QR pages).
 */
export function track<E extends ClientEventName>(name: E, ...[params]: ParamsArg<E>): void {
  if (!trackingActive()) return;
  if (typeof window === "undefined" || contentGroupFor(window.location.pathname) === null) return;
  const checked = validateTrackingEvent("client", name, params ?? {});
  if (!checked.ok) {
    if (process.env.NODE_ENV !== "production")
      console.warn(`[tracking] dropped ${name}: ${checked.reason}`);
    return;
  }
  gtagEvent(name, checked.params);
}

const sentOnce = new Set<string>();

/** `track`, at most once per page load (e.g. the first focus in the sign-up form). */
export function trackOnce<E extends ClientEventName>(name: E, ...args: ParamsArg<E>): void {
  if (sentOnce.has(name) || !trackingActive()) return;
  sentOnce.add(name);
  track(name, ...args);
}

/** `track` once when the calling component mounts (e.g. the upgrade dialog opening). */
export function useTrackOnMount<E extends ClientEventName>(name: E, ...args: ParamsArg<E>): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track(name, ...args);
  });
}

/** Tests only. */
export function resetTrackOnceForTests(): void {
  sentOnce.clear();
}
