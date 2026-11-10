import { z } from "zod";

import { planKeySchema } from "./platform";

/**
 * Growth-measurement event catalog (Google Analytics 4): the single allowlist
 * of event names and parameter schemas shared by the browser tracker
 * (@ros/web-core/tracking) and the server's Measurement Protocol adapter.
 *
 * Parameters are strict objects of enums, booleans, bounded numbers and
 * slug-shaped plan keys. There is no field that can hold a person's name,
 * email, phone, a payment detail, a token or a tenant id: TypeScript rejects
 * an unknown key, and `validateTrackingEvent` drops the event at runtime.
 * Spec, privacy rules and the funnel: docs/growth/analytics-events.md.
 */

/** Where an event is produced. `database` events are never sent to GA4; they are derived from SQL. */
export type TrackingSource = "client" | "server" | "database";

/**
 * Plan keys are slugs chosen by the Super Admin (starter, pro, ...), never
 * tenant data: exactly the platform's own rule, so no valid plan is dropped.
 */
const planKey = planKeySchema;
const billingCycle = z.enum(["monthly", "annual"]);
const currency = z.string().regex(/^[A-Z]{3}$/);
/** The plan's list price in major units (rupees). */
const value = z.number().nonnegative().max(10_000_000);
/** A path that has already been through the browser's URL sanitizer. */
const sanitizedPath = z
  .string()
  .max(200)
  .regex(/^\/[A-Za-z0-9/_:.-]*$/);

interface SentEvent {
  source: "client" | "server";
  /** Mark as a key event in GA4 Admin (docs list the exact steps). */
  keyEvent: boolean;
  params: z.ZodObject;
}
interface DerivedEvent {
  source: "database";
  keyEvent: false;
  params: null;
}

export const TRACKING_EVENTS = {
  landing_page_view: {
    source: "client",
    keyEvent: false,
    params: z.strictObject({ landing_page: sanitizedPath }),
  },
  signup_started: {
    source: "client",
    keyEvent: false,
    params: z.strictObject({ invited: z.boolean() }),
  },
  signup_completed: {
    source: "client",
    keyEvent: true,
    params: z.strictObject({ method: z.literal("password"), invited: z.boolean() }),
  },
  login_completed: {
    source: "client",
    keyEvent: false,
    params: z.strictObject({ method: z.literal("password") }),
  },
  workspace_created: { source: "client", keyEvent: false, params: z.strictObject({}) },
  restaurant_created: { source: "client", keyEvent: false, params: z.strictObject({}) },
  branch_created: { source: "client", keyEvent: false, params: z.strictObject({}) },
  menu_item_created: { source: "client", keyEvent: false, params: z.strictObject({}) },
  /**
   * One per user action: a single generate/regenerate (count 1), or one for a
   * bulk run such as onboarding's tables or "Generate missing" (count = codes).
   */
  qr_generated: {
    source: "client",
    keyEvent: true,
    params: z.strictObject({ count: z.number().int().min(1).max(1000) }),
  },
  qr_menu_viewed: { source: "database", keyEvent: false, params: null },
  order_submitted: { source: "database", keyEvent: false, params: null },
  order_accepted: { source: "database", keyEvent: false, params: null },
  order_completed: { source: "database", keyEvent: false, params: null },
  /**
   * Cancellations (and manual activations) are Super Admin actions: no
   * consented browser of the customer is behind them, so they stay in the
   * database (`subscription_events`) and are never sent.
   */
  subscription_cancelled: { source: "database", keyEvent: false, params: null },
  trial_started: {
    source: "server",
    keyEvent: true,
    params: z.strictObject({ plan_key: planKey, trial_days: z.number().int().min(0).max(366) }),
  },
  upgrade_clicked: {
    source: "client",
    keyEvent: false,
    params: z.strictObject({ plan_key: planKey.optional() }),
  },
  checkout_started: {
    source: "client",
    keyEvent: false,
    params: z.strictObject({ plan_key: planKey, billing_cycle: billingCycle, value, currency }),
  },
  payment_succeeded: {
    source: "server",
    keyEvent: true,
    params: z.strictObject({
      plan_key: planKey,
      billing_cycle: billingCycle,
      value,
      currency,
      /** The workspace was already on an active paid plan (a renewal or a plan change). */
      renewal: z.boolean(),
    }),
  },
  /** A workspace became ACTIVE from trial, expiry or cancellation; never sent for a renewal. */
  subscription_activated: {
    source: "server",
    keyEvent: true,
    params: z.strictObject({ plan_key: planKey, billing_cycle: billingCycle }),
  },
} as const satisfies Record<string, SentEvent | DerivedEvent>;

type Catalog = typeof TRACKING_EVENTS;
export type TrackingEventName = keyof Catalog;
type NamesFrom<S extends TrackingSource> = {
  [K in TrackingEventName]: Catalog[K]["source"] extends S ? K : never;
}[TrackingEventName];

/** Events the browser may send (after consent). */
export type ClientEventName = NamesFrom<"client">;
/** Events only the server sends, after the business transaction committed. */
export type ServerEventName = NamesFrom<"server">;

export type TrackingParams<E extends ClientEventName | ServerEventName> = z.input<
  Catalog[E]["params"]
>;

export type ServerTrackingEvent = {
  [E in ServerEventName]: { name: E; params: TrackingParams<E> };
}[ServerEventName];

/** Values a sent parameter may take after validation. */
export type TrackingParamValue = string | number | boolean;

/** A 24+ character run is a token only if it mixes in digits or capitals; long lowercase words are prose. */
function looksLikeToken(text: string): boolean {
  return (text.match(/[A-Za-z0-9_-]{24,}/g) ?? []).some((run) => /[A-Z0-9]/.test(run));
}

/**
 * Shapes that never belong in an analytics payload. A second line of
 * defence behind the strict schemas (which already admit no free text).
 * Plan keys are slugs the platform already validated, so the length-based
 * checks are looser there (`slug`): long words and short dates are fine, a
 * 10-digit run (a mobile number) is not; `false` skips the check.
 */
type PiiTest = (text: string) => boolean;
const PII_CHECKS: readonly { kind: string; test: PiiTest; slug?: PiiTest | false }[] = [
  { kind: "email", test: (t) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) },
  {
    kind: "phone",
    test: (t) => /(?:\+?\d[\s().-]?){8,}/.test(t),
    slug: (t) => /(?:\d[-_]?){10,}/.test(t),
  },
  {
    kind: "uuid",
    test: (t) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t),
  },
  { kind: "jwt", test: (t) => /eyJ[\w-]+\.[\w-]+/.test(t) },
  { kind: "token", test: looksLikeToken, slug: false },
];

/** Parameters whose schema already admits only a slug (`planKeySchema`). */
const SLUG_PARAMS = new Set(["plan_key"]);

/** The name of the first PII check `text` fails, or null. */
export function piiKind(text: string, options: { slug?: boolean } = {}): string | null {
  for (const check of PII_CHECKS) {
    const test = options.slug && check.slug !== undefined ? check.slug : check.test;
    if (test && test(text)) return check.kind;
  }
  return null;
}

export type TrackingValidation =
  { ok: true; params: Record<string, TrackingParamValue> } | { ok: false; reason: string };

/** GA4 collection limits for a standard property (support.google.com/analytics/answer/9267744). */
export const GA4_LIMITS = {
  eventNameLength: 40,
  paramsPerEvent: 25,
  paramNameLength: 40,
  paramValueLength: 100,
} as const;

/**
 * Runtime gate for every event, client or server: the name must be in the
 * catalog for that source, the params must parse against its strict schema,
 * and no string value may look like personal data or a secret.
 */
export function validateTrackingEvent(
  source: "client" | "server",
  name: string,
  params: unknown,
): TrackingValidation {
  const spec = (TRACKING_EVENTS as Record<string, SentEvent | DerivedEvent>)[name];
  if (!spec || spec.source !== source) return { ok: false, reason: "unknown_event" };
  if (!spec.params) return { ok: false, reason: "unknown_event" };
  const parsed = spec.params.safeParse(params ?? {});
  if (!parsed.success) return { ok: false, reason: "invalid_params" };
  const out: Record<string, TrackingParamValue> = {};
  for (const [key, v] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      if (v.length > GA4_LIMITS.paramValueLength) return { ok: false, reason: "value_too_long" };
      if (piiKind(v, { slug: SLUG_PARAMS.has(key) })) return { ok: false, reason: "pii" };
    }
    out[key] = v as TrackingParamValue;
  }
  if (Object.keys(out).length > GA4_LIMITS.paramsPerEvent)
    return { ok: false, reason: "too_many_params" };
  return { ok: true, params: out };
}

/** Plan billing cycle in GA4's lowercase form. */
export function trackingBillingCycle(cycle: "MONTHLY" | "ANNUAL"): "monthly" | "annual" {
  return cycle === "ANNUAL" ? "annual" : "monthly";
}

/** Minor units (paise) to the major units GA4 expects in `value` (rupees). */
export function majorUnits(amountMinor: number, currencyCode: string): number {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // Unknown currency code: keep two decimals.
  }
  return amountMinor / 10 ** digits;
}

// ---------------------------------------------------------------- consent + GA cookies

/**
 * First-party cookie holding the visitor's analytics choice (`granted` or
 * `denied`). Not HttpOnly: the browser reads it to decide whether to load
 * gtag.js; the API reads it before using the GA client id for attribution.
 */
export const ANALYTICS_CONSENT_COOKIE = "ros_analytics_consent";
/** The choice is asked again after 180 days. GA cookies use the same lifetime. */
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface AnalyticsIds {
  /** GA4 client id: the last two fields of the `_ga` cookie (`<random>.<first-visit seconds>`). */
  clientId: string;
  /** Current GA4 session id from the `_ga_<container>` cookie, when it can be read. */
  sessionId: string | null;
}

const CLIENT_ID = /^\d{1,12}\.\d{9,11}$/;

/**
 * The ids for a server event whose browser is not in the request (a payment
 * webhook): the client id recorded with the checkout, which is stored only
 * when the buyer had opted in. No session: the checkout's session is over.
 */
export function storedAnalyticsIds(clientId: string | null | undefined): AnalyticsIds | null {
  return clientId && CLIENT_ID.test(clientId) ? { clientId, sessionId: null } : null;
}

/**
 * The browser's GA4 ids from a Cookie header, for attributing server events to
 * the visitor's own GA4 data. Null unless the visitor opted in (consent
 * cookie `granted`) and a well-formed `_ga` cookie for this property exists;
 * the cookies are only ever set after opt-in.
 */
export function consentedAnalyticsIds(
  cookieHeader: string | null,
  measurementId: string | null | undefined,
): AnalyticsIds | null {
  if (!cookieHeader || !measurementId) return null;
  if (cookieValue(cookieHeader, ANALYTICS_CONSENT_COOKIE) !== "granted") return null;
  const ga = /^GA1\.\d+\.(\d{1,12}\.\d{9,11})$/.exec(cookieValue(cookieHeader, "_ga") ?? "");
  if (!ga) return null;
  const session = cookieValue(cookieHeader, `_ga_${measurementId.replace(/^G-/, "")}`) ?? "";
  // GS1.1.<session>.… (classic) or GS2.1.s<session>$o…$g… (2025 format).
  const sid = /^GS1\.\d+\.(\d{9,11})\./.exec(session) ?? /^GS2\.\d+\.s(\d{9,11})\$/.exec(session);
  return { clientId: ga[1]!, sessionId: sid?.[1] ?? null };
}
