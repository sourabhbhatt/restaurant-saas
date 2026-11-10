import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { API_EVENT_RULES, handleApiSuccess } from "./api-events";
import { useTrackingStore } from "./consent";
import { configureGtag } from "./gtag";
import { TEST_ID, events, resetTracking, setConsentCookie, setPath } from "./test-helpers";

const ID = "0b3c6c2e-5d0e-4f43-9d55-0a4c3f0e5c11";

beforeEach(() => {
  resetTracking();
  setConsentCookie("granted");
  useTrackingStore.setState({ measurementId: TEST_ID, consent: "granted" });
  configureGtag(TEST_ID, { debug: false });
  setPath("/app/onboarding");
});
afterEach(() => resetTracking());

const post = (url: string, data: unknown = {}) => handleApiSuccess({ method: "POST", url, data });

describe("server-confirmed product events", () => {
  it("maps each accepted mutation to its event, and nothing else", () => {
    post("/api/v1/workspaces", { id: ID, name: "Spice Garden", businessEmail: "a@b.co" });
    post(`/api/v1/workspaces/${ID}/restaurants`);
    post(`/api/v1/restaurants/${ID}/branches`);
    post(`/api/v1/restaurants/${ID}/menu/items`);
    post(`/api/v1/restaurants/${ID}/menu/categories`);
    post(`/api/v1/tables/${ID}/qr`);
    post(`/api/v1/branches/${ID}/tables/bulk`);
    handleApiSuccess({ method: "PATCH", url: `/api/v1/workspaces/${ID}`, data: {} });
    handleApiSuccess({ method: "DELETE", url: `/api/v1/tables/${ID}/qr`, data: {} });

    expect(events().map((e) => e.name)).toEqual([
      "workspace_created",
      "restaurant_created",
      "branch_created",
      "menu_item_created",
      "qr_generated",
    ]);
    expect(JSON.stringify(events())).not.toMatch(/Spice|a@b\.co|0b3c6c2e/);
  });

  it("tells an invited teammate's sign-up apart from a new customer's", () => {
    setPath("/sign-up");
    post("/api/v1/auth/signup", { user: { name: "Asha", email: "asha@example.com" } });
    setPath(`/sign-up?next=${encodeURIComponent("/invite/GYw3TEwFZ7bpHJOKMnagBoWJxEwV")}`);
    post("/api/v1/auth/signup", { user: { name: "Ravi", email: "ravi@example.com" } });
    setPath("/sign-in");
    post("/api/v1/auth/signin", { user: { name: "Asha" } });

    expect(events()).toEqual([
      { name: "signup_completed", params: { method: "password", invited: false } },
      { name: "signup_completed", params: { method: "password", invited: true } },
      { name: "login_completed", params: { method: "password" } },
    ]);
  });

  it("reads only the plan and list price of a checkout", () => {
    post(`/api/v1/organizations/${ID}/checkout`, {
      provider: "razorpay",
      keyId: "rzp_test_x",
      orderId: "order_abc",
      paymentOrderId: ID,
      amountMinor: 1_799_00,
      currency: "INR",
      planKey: "pro",
      planName: "Pro",
      billingCycle: "ANNUAL",
      organizationName: "Spice Garden Pvt Ltd",
    });
    expect(events()).toEqual([
      {
        name: "checkout_started",
        params: { plan_key: "pro", billing_cycle: "annual", value: 1799, currency: "INR" },
      },
    ]);
  });
});

describe("API_EVENT_RULES", () => {
  it("each template matches a real API route that accepts POST", () => {
    const v1 = path.resolve(import.meta.dirname, "../../../../apps/api/src/app/api/v1");
    for (const { route } of API_EVENT_RULES) {
      let dir = v1;
      for (const segment of route.split("/").filter(Boolean)) {
        const next =
          segment === ":id"
            ? readdirSync(dir).find((d) => d.startsWith("[") && !d.startsWith("[..."))
            : segment;
        expect(next, `${route}: no directory for ${segment} in ${dir}`).toBeDefined();
        dir = path.join(dir, next!);
      }
      const file = path.join(dir, "route.ts");
      expect(existsSync(file), `${route}: ${file} missing`).toBe(true);
      expect(readFileSync(file, "utf8"), `${route} has no POST`).toMatch(
        /export (const|async function) POST\b/,
      );
    }
  });
});
