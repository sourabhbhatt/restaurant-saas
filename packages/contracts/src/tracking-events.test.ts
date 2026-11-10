import { describe, expect, it } from "vitest";

import {
  ANALYTICS_CONSENT_COOKIE,
  GA4_LIMITS,
  TRACKING_EVENTS,
  consentedAnalyticsIds,
  majorUnits,
  piiKind,
  storedAnalyticsIds,
  validateTrackingEvent,
  type TrackingParams,
} from "./tracking-events";

const REQUIRED = [
  "landing_page_view",
  "signup_started",
  "signup_completed",
  "login_completed",
  "workspace_created",
  "restaurant_created",
  "branch_created",
  "menu_item_created",
  "qr_generated",
  "qr_menu_viewed",
  "order_submitted",
  "order_accepted",
  "order_completed",
  "trial_started",
  "upgrade_clicked",
  "checkout_started",
  "payment_succeeded",
  "subscription_activated",
  "subscription_cancelled",
];

describe("tracking event catalog", () => {
  it("covers exactly the specified growth events", () => {
    expect(Object.keys(TRACKING_EVENTS).sort()).toEqual([...REQUIRED].sort());
  });

  it("uses names and parameter names GA4 accepts", () => {
    for (const [name, spec] of Object.entries(TRACKING_EVENTS)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.length).toBeLessThanOrEqual(GA4_LIMITS.eventNameLength);
      // Reserved prefixes for event and parameter names (Measurement Protocol reference).
      expect(name).not.toMatch(/^(_|ga_|google_|firebase_)/);
      for (const param of Object.keys(spec.params?.shape ?? {})) {
        expect(param.length).toBeLessThanOrEqual(GA4_LIMITS.paramNameLength);
        expect(param).not.toMatch(/^(_|ga_|google_|firebase_|gtag\.)/);
      }
    }
  });

  it("keeps the key events within the 30 a standard property allows", () => {
    const keyEvents = Object.values(TRACKING_EVENTS).filter((e) => e.keyEvent);
    expect(keyEvents.length).toBeGreaterThan(0);
    expect(keyEvents.length).toBeLessThanOrEqual(30);
  });

  it("never sends database-derived diner, kitchen and Super Admin events", () => {
    for (const name of [
      "qr_menu_viewed",
      "order_submitted",
      "order_accepted",
      "order_completed",
      // Cancelled by a Super Admin: no consented browser of the customer behind it.
      "subscription_cancelled",
    ]) {
      expect(validateTrackingEvent("client", name, {})).toEqual({
        ok: false,
        reason: "unknown_event",
      });
      expect(validateTrackingEvent("server", name, {})).toEqual({
        ok: false,
        reason: "unknown_event",
      });
    }
  });
});

describe("validateTrackingEvent", () => {
  it("accepts a well-formed event", () => {
    expect(
      validateTrackingEvent("server", "payment_succeeded", {
        plan_key: "pro",
        billing_cycle: "monthly",
        value: 1499,
        currency: "INR",
        renewal: false,
      }),
    ).toEqual({
      ok: true,
      params: {
        plan_key: "pro",
        billing_cycle: "monthly",
        value: 1499,
        currency: "INR",
        renewal: false,
      },
    });
  });

  it("labels renewals on payments and counts only first activations", () => {
    const paid = { plan_key: "pro", billing_cycle: "annual", value: 14990, currency: "INR" };
    expect(
      validateTrackingEvent("server", "payment_succeeded", { ...paid, renewal: true }),
    ).toEqual({ ok: true, params: { ...paid, renewal: true } });
    expect(
      validateTrackingEvent("server", "subscription_activated", {
        plan_key: "pro",
        billing_cycle: "annual",
      }).ok,
    ).toBe(true);
    // Manual (Super Admin) activations are no longer sent, so there is no source to label.
    expect(
      validateTrackingEvent("server", "subscription_activated", {
        plan_key: "pro",
        billing_cycle: "annual",
        activation_source: "manual",
      }),
    ).toEqual({ ok: false, reason: "invalid_params" });
  });

  it("counts QR codes per user action: one event carrying how many were generated", () => {
    expect(validateTrackingEvent("client", "qr_generated", { count: 10 })).toEqual({
      ok: true,
      params: { count: 10 },
    });
    for (const params of [{}, { count: 0 }, { count: 1.5 }, { count: 1001 }])
      expect(validateTrackingEvent("client", "qr_generated", params).ok).toBe(false);
  });

  it.each([
    ["two characters", "ab"],
    ["a leading digit", "2026-pro"],
    ["40 characters", "a".repeat(40)],
    ["a 24+ character slug", "professional-annual-plan"],
    ["eight digits", "pro-20261110"],
    ["underscores", "chain_annual_v2"],
  ])("accepts every plan key the platform accepts: %s", (_label, planKey) => {
    expect(validateTrackingEvent("client", "upgrade_clicked", { plan_key: planKey })).toEqual({
      ok: true,
      params: { plan_key: planKey },
    });
  });

  it.each([
    ["one character", "a"],
    ["41 characters", "a".repeat(41)],
    ["upper case", "Pro"],
    // Valid slugs on the platform, but shaped like personal data: never sent.
    ["a mobile number", "9845012345"],
    ["a dashed mobile number", "98450-12345"],
    ["a uuid", "0b3c6c2e-5d0e-4f43-9d55-0a4c3f0e5c11"],
  ])(
    "drops a plan key the platform would refuse or that looks like personal data: %s",
    (_label, planKey) => {
      expect(validateTrackingEvent("client", "upgrade_clicked", { plan_key: planKey }).ok).toBe(
        false,
      );
    },
  );

  it("keeps a long, sanitized marketing path as the landing page", () => {
    expect(
      validateTrackingEvent("client", "landing_page_view", {
        landing_page: "/restaurant-billing-software-india",
      }),
    ).toEqual({ ok: true, params: { landing_page: "/restaurant-billing-software-india" } });
  });

  it("rejects names outside the allowlist and events from the wrong source", () => {
    expect(validateTrackingEvent("client", "purchase", {}).ok).toBe(false);
    expect(validateTrackingEvent("client", "payment_succeeded", {}).ok).toBe(false);
    expect(validateTrackingEvent("server", "signup_completed", {}).ok).toBe(false);
  });

  it.each([
    ["an email", { method: "password", invited: false, email: "asha@example.com" }],
    ["a name", { method: "password", invited: false, name: "Asha Rao" }],
    ["a phone number", { method: "password", invited: false, phone: "+91 98450 12345" }],
    ["a user id", { method: "password", invited: false, user_id: "u_1" }],
  ])("drops signup_completed carrying %s (unknown key)", (_label, params) => {
    expect(validateTrackingEvent("client", "signup_completed", params)).toEqual({
      ok: false,
      reason: "invalid_params",
    });
  });

  it.each([
    ["an email", "asha@example.com"],
    ["a uuid", "0b3c6c2e-5d0e-4f43-9d55-0a4c3f0e5c11"],
    ["a token", "GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4"],
  ])("drops a plan_key holding %s", (_label, planKey) => {
    expect(validateTrackingEvent("client", "upgrade_clicked", { plan_key: planKey }).ok).toBe(
      false,
    );
  });

  it("drops a path that was not sanitized", () => {
    expect(
      validateTrackingEvent("client", "landing_page_view", {
        landing_page: "/reset-password?token=abc",
      }).ok,
    ).toBe(false);
    expect(
      validateTrackingEvent("client", "landing_page_view", {
        landing_page: "/t/GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4",
      }),
    ).toEqual({ ok: false, reason: "pii" });
  });

  it("makes personal data a type error at the call site", () => {
    const ok: TrackingParams<"signup_completed"> = { method: "password", invited: false };
    const bad: TrackingParams<"signup_completed"> = {
      method: "password",
      invited: false,
      // @ts-expect-error — `email` is not a parameter of signup_completed.
      email: "",
    };
    // @ts-expect-error — order events are database-derived and have no client params type.
    const derived: TrackingParams<"order_submitted"> = {};
    expect([ok, bad, derived]).toHaveLength(3);
  });
});

describe("piiKind", () => {
  it.each([
    ["owner@demo.local", "email"],
    ["98450 12345", "phone"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0", "jwt"],
    ["GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4", "token"],
    ["5f4dcc3b5aa765d61d8327deb882cf99", "token"],
    ["pro", null],
    ["/app/w/:id/restaurants", null],
    // Long lowercase words are prose, not secrets.
    ["/restaurant-billing-software-india", null],
  ])("%s → %s", (text, kind) => {
    expect(piiKind(text)).toBe(kind);
  });
});

describe("consentedAnalyticsIds", () => {
  const ID = "G-TEST123456";
  const consent = `${ANALYTICS_CONSENT_COOKIE}=granted`;

  it("reads the client id and session id once the visitor opted in", () => {
    const header = `ros_session=x; ${consent}; _ga=GA1.1.1234567890.1700000000; _ga_TEST123456=GS2.1.s1700000500$o3$g1$t1700000600$j0$l0$h0`;
    expect(consentedAnalyticsIds(header, ID)).toEqual({
      clientId: "1234567890.1700000000",
      sessionId: "1700000500",
    });
  });

  it("reads the classic session cookie format", () => {
    const header = `${consent}; _ga=GA1.2.42.1700000000; _ga_TEST123456=GS1.1.1700000777.4.1.1700000800.0.0.0`;
    expect(consentedAnalyticsIds(header, ID)?.sessionId).toBe("1700000777");
  });

  it.each([
    ["no consent cookie", "_ga=GA1.1.1234567890.1700000000"],
    ["a declined choice", `${ANALYTICS_CONSENT_COOKIE}=denied; _ga=GA1.1.1234567890.1700000000`],
    ["a malformed _ga cookie", `${consent}; _ga=GA1.1.not-a-number`],
    ["no _ga cookie", consent],
  ])("is null with %s", (_label, header) => {
    expect(consentedAnalyticsIds(header, ID)).toBeNull();
  });

  it("is null when no Measurement ID is configured", () => {
    expect(consentedAnalyticsIds(`${consent}; _ga=GA1.1.1.1700000000`, undefined)).toBeNull();
  });
});

describe("storedAnalyticsIds", () => {
  it("rebuilds the ids from a client id kept with a checkout (no session)", () => {
    expect(storedAnalyticsIds("987654321.1790000000")).toEqual({
      clientId: "987654321.1790000000",
      sessionId: null,
    });
  });

  it.each([null, "", "not-an-id", "987654321.1790000000; drop table"])("is null for %j", (v) => {
    expect(storedAnalyticsIds(v)).toBeNull();
  });
});

describe("majorUnits", () => {
  it("converts paise to rupees", () => {
    expect(majorUnits(149_900, "INR")).toBe(1499);
  });
});
