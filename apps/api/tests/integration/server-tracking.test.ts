import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as cancel } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/cancel/route";
import { POST as checkout } from "@/app/api/v1/organizations/[organizationId]/checkout/route";
import { POST as verify } from "@/app/api/v1/organizations/[organizationId]/checkout/verify/route";
import { POST as webhook } from "@/app/api/v1/webhooks/razorpay/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import type { CheckoutSessionDto, WebhookResultDto } from "@ros/contracts/payments";
import { ANALYTICS_CONSENT_COOKIE } from "@ros/contracts/tracking-events";
import { createFakePaymentGateway } from "@ros/adapters/payments/providers/fake";
import { createMemoryServerTracking } from "@ros/adapters/tracking/providers/memory";
import { resetEnvCache } from "@ros/application/config/env";
import type { Container } from "@/composition/container";
import { createWorkspaceAs, organizationOf, signUpUser, type TestUser } from "@/test/fixtures";
import { signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

/**
 * Server-authoritative growth events (docs/growth/analytics-events.md): each
 * fires once, after the business transaction committed, and is attributed to
 * the customer's browser only when that browser opted in.
 */
const MEASUREMENT_ID = "G-SRVTEST01";
const SECRETS = { keySecret: "key-secret-for-tests", webhookSecret: "webhook-secret-for-tests" };
const fake = createFakePaymentGateway(SECRETS);
const tracking = createMemoryServerTracking();
const GA_COOKIES = `${ANALYTICS_CONSENT_COOKIE}=granted; _ga=GA1.1.987654321.1790000000; _ga_SRVTEST01=GS2.1.s1790000100$o2$g1$t1790000200$j0$l0$h0`;

let c: Container;
let admin: TestUser;

beforeAll(async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
  process.env.GA_MEASUREMENT_ID = MEASUREMENT_ID;
  c = await createTestContainer({ payments: fake, tracking });
  admin = await signUpAdmin(c);
});
afterAll(async () => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.GA_MEASUREMENT_ID;
  resetEnvCache();
  await c.close();
});
beforeEach(() => tracking.clear());

const names = () => tracking.events.map((e) => e.event.name);

async function owner(name: string, cookieExtra?: string) {
  const user = await signUpUser(`${name} Owner`);
  const res = await call<{ id: string }>(createWorkspace, {
    body: { name: `${name} Kitchen` },
    cookie: cookieExtra ? `${user.cookie}; ${cookieExtra}` : user.cookie,
  });
  expect(res.status).toBe(201);
  return { user, ws: res.body.data!, organizationId: await organizationOf(c, res.body.data!.id) };
}

async function startCheckout(user: TestUser, organizationId: string) {
  const res = await call<CheckoutSessionDto>(checkout, {
    params: { organizationId },
    cookie: user.cookie,
    body: { planKey: "pro", billingCycle: "MONTHLY" },
  });
  expect(res.status).toBe(201);
  return res.body.data!;
}

function verifyAs(
  user: TestUser,
  organizationId: string,
  s: CheckoutSessionDto,
  paymentId: string,
  cookieExtra?: string,
) {
  return call(verify, {
    params: { organizationId },
    cookie: cookieExtra ? `${user.cookie}; ${cookieExtra}` : user.cookie,
    body: {
      razorpayOrderId: s.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: fake.signPayment(s.orderId, paymentId),
    },
  });
}

let eventSeq = 0;
function postWebhook(s: CheckoutSessionDto, paymentId: string, eventId = `evt_trk_${++eventSeq}`) {
  const body = {
    entity: "event",
    event: "order.paid",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          amount: s.amountMinor,
          currency: s.currency,
          status: "captured",
          order_id: s.orderId,
        },
      },
    },
  };
  return call<WebhookResultDto>(webhook, {
    path: "/api/v1/webhooks/razorpay",
    body,
    origin: "https://api.razorpay.com",
    headers: {
      "x-razorpay-signature": fake.signWebhook(JSON.stringify(body)),
      "x-razorpay-event-id": eventId,
    },
  });
}

describe("trial_started", () => {
  it("fires once for a first workspace, attributed to the consented browser", async () => {
    await owner("Consented", GA_COOKIES);
    expect(tracking.events).toEqual([
      {
        event: {
          name: "trial_started",
          params: { plan_key: expect.any(String), trial_days: expect.any(Number) },
        },
        context: { analytics: { clientId: "987654321.1790000000", sessionId: "1790000100" } },
      },
    ]);
    expect(tracking.rejected).toEqual([]);
  });

  it("is anonymous when the browser declined or never chose", async () => {
    await owner("Declined", `${ANALYTICS_CONSENT_COOKIE}=denied; _ga=GA1.1.987654321.1790000000`);
    await owner("Silent");
    expect(tracking.events.map((e) => e.context.analytics)).toEqual([null, null]);
  });

  it("does not fire when a trial is refused", async () => {
    const { user } = await owner("Twice");
    tracking.clear();
    const again = await call(createWorkspace, { body: { name: "Second" }, cookie: user.cookie });
    expect(again.status).not.toBe(201);
    expect(tracking.events).toEqual([]);
  });
});

describe("payment_succeeded and subscription_activated", () => {
  it("verify activation emits the pair once with the consented ids; repeats and the webhook replay emit nothing", async () => {
    const { user, organizationId } = await owner("Verify");
    const s = await startCheckout(user, organizationId);
    const paymentId = fake.capture(s.orderId);
    tracking.clear();

    expect((await verifyAs(user, organizationId, s, paymentId, GA_COOKIES)).status).toBe(200);
    expect(tracking.events).toEqual([
      {
        event: {
          name: "payment_succeeded",
          params: {
            plan_key: "pro",
            billing_cycle: "monthly",
            value: s.amountMinor / 100,
            currency: "INR",
          },
        },
        context: { analytics: { clientId: "987654321.1790000000", sessionId: "1790000100" } },
      },
      {
        event: {
          name: "subscription_activated",
          params: {
            plan_key: "pro",
            billing_cycle: "monthly",
            activation_source: "online_payment",
          },
        },
        context: { analytics: { clientId: "987654321.1790000000", sessionId: "1790000100" } },
      },
    ]);

    // A refresh of the success page, a client retry, and the provider's own webhook afterwards.
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);
    const late = await postWebhook(s, paymentId);
    expect(late.body.data?.outcome).toBe("already_paid");
    expect(names()).toEqual(["payment_succeeded", "subscription_activated"]);
  });

  it("webhook activation emits once, anonymously; a duplicate delivery and a later verify emit nothing", async () => {
    const { user, organizationId } = await owner("Hook");
    const s = await startCheckout(user, organizationId);
    const paymentId = fake.capture(s.orderId);
    tracking.clear();

    const first = await postWebhook(s, paymentId, "evt_trk_dup");
    expect(first.body.data?.outcome).toBe("activated");
    const replay = await postWebhook(s, paymentId, "evt_trk_dup");
    expect(replay.body.data?.outcome).toBe("duplicate");
    const other = await postWebhook(s, paymentId);
    expect(other.body.data?.outcome).toBe("already_paid");
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);

    expect(names()).toEqual(["payment_succeeded", "subscription_activated"]);
    expect(tracking.events.every((e) => e.context.analytics === null)).toBe(true);
  });

  it("a payment that does not match never emits", async () => {
    const { user, organizationId } = await owner("Short");
    const s = await startCheckout(user, organizationId);
    const paymentId = fake.capture(s.orderId, s.amountMinor - 1);
    tracking.clear();
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);
    expect(tracking.events).toEqual([]);
  });
});

describe("Super Admin actions", () => {
  it("manual activation and cancellation are anonymous, never the admin's own browser", async () => {
    const { ws } = await owner("Manual");
    tracking.clear();
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const activated = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: `${admin.cookie}; ${GA_COOKIES}`,
      body: { planKey: "pro", billingCycle: "ANNUAL", periodEnd },
    });
    expect(activated.status).toBe(200);
    const cancelled = await call(cancel, {
      params: { workspaceId: ws.id },
      cookie: `${admin.cookie}; ${GA_COOKIES}`,
      body: { reason: "Customer asked to stop" },
    });
    expect(cancelled.status).toBe(200);
    const refused = await call(cancel, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { reason: "Again" },
    });
    expect(refused.status).toBe(409);

    expect(tracking.events).toEqual([
      {
        event: {
          name: "subscription_activated",
          params: { plan_key: "pro", billing_cycle: "annual", activation_source: "manual" },
        },
        context: {},
      },
      {
        event: {
          name: "subscription_cancelled",
          params: { plan_key: "pro", previous_status: "active" },
        },
        context: {},
      },
    ]);
  });
});

describe("failure isolation", () => {
  it("an adapter that throws never breaks the business operation", async () => {
    const original = c.tracking.track;
    c.tracking.track = () => {
      throw new Error("adapter exploded");
    };
    try {
      const user = await signUpUser("Exploding Owner");
      const ws = await createWorkspaceAs(user, "Exploding Kitchen");
      expect(ws.id).toBeTruthy();
    } finally {
      c.tracking.track = original;
    }
  });
});
