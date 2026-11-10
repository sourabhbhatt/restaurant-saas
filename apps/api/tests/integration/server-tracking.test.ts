import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as cancel } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/cancel/route";
import { POST as runJob } from "@/app/api/v1/jobs/subscriptions/route";
import { POST as checkout } from "@/app/api/v1/organizations/[organizationId]/checkout/route";
import { POST as verify } from "@/app/api/v1/organizations/[organizationId]/checkout/verify/route";
import { POST as webhook } from "@/app/api/v1/webhooks/razorpay/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import type { CheckoutSessionDto, WebhookResultDto } from "@ros/contracts/payments";
import { ANALYTICS_CONSENT_COOKIE } from "@ros/contracts/tracking-events";
import { createFakePaymentGateway } from "@ros/adapters/payments/providers/fake";
import { createMemoryServerTracking } from "@ros/adapters/tracking/providers/memory";
import { resetEnvCache } from "@ros/application/config/env";
import { paymentOrders } from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import { organizationOf, signUpUser, type TestUser } from "@/test/fixtures";
import { signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

/**
 * Server-authoritative growth events (docs/growth/analytics-events.md): each
 * fires once, after the business transaction committed, and only for a
 * person who opted in to analytics. Nothing is sent for anyone else.
 */
const MEASUREMENT_ID = "G-SRVTEST01";
const SECRETS = { keySecret: "key-secret-for-tests", webhookSecret: "webhook-secret-for-tests" };
const fake = createFakePaymentGateway(SECRETS);
const tracking = createMemoryServerTracking();
const GA_COOKIES = `${ANALYTICS_CONSENT_COOKIE}=granted; _ga=GA1.1.987654321.1790000000; _ga_SRVTEST01=GS2.1.s1790000100$o2$g1$t1790000200$j0$l0$h0`;
const DECLINED = `${ANALYTICS_CONSENT_COOKIE}=denied; _ga=GA1.1.987654321.1790000000`;
const BROWSER = { clientId: "987654321.1790000000", sessionId: "1790000100" };
/** The checkout's opt-in carried to a webhook: the client id only, no session. */
const STORED = { clientId: "987654321.1790000000", sessionId: null };

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

const withCookies = (user: TestUser, extra?: string) =>
  extra ? `${user.cookie}; ${extra}` : user.cookie;

async function owner(name: string, cookieExtra?: string) {
  const user = await signUpUser(`${name} Owner`);
  const res = await call<{ id: string }>(createWorkspace, {
    body: { name: `${name} Kitchen` },
    cookie: withCookies(user, cookieExtra),
  });
  expect(res.status).toBe(201);
  return { user, ws: res.body.data!, organizationId: await organizationOf(c, res.body.data!.id) };
}

async function startCheckout(user: TestUser, organizationId: string, cookieExtra?: string) {
  const res = await call<CheckoutSessionDto>(checkout, {
    params: { organizationId },
    cookie: withCookies(user, cookieExtra),
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
    cookie: withCookies(user, cookieExtra),
    body: {
      razorpayOrderId: s.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: fake.signPayment(s.orderId, paymentId),
    },
  });
}

/** The GA4 client id kept with a checkout (only when its buyer opted in). */
async function storedClientId(s: CheckoutSessionDto): Promise<string | null> {
  const [row] = await c.db
    .select({ id: paymentOrders.analyticsClientId })
    .from(paymentOrders)
    .where(eq(paymentOrders.providerOrderId, s.orderId));
  return row!.id;
}

const paid = (amountMinor: number, renewal: boolean) => ({
  name: "payment_succeeded",
  params: {
    plan_key: "pro",
    billing_cycle: "monthly",
    value: amountMinor / 100,
    currency: "INR",
    renewal,
  },
});
const activated = {
  name: "subscription_activated",
  params: { plan_key: "pro", billing_cycle: "monthly" },
};

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
        context: { analytics: BROWSER },
      },
    ]);
    expect(tracking.rejected).toEqual([]);
  });

  it("is never sent for a person who declined or never chose", async () => {
    await owner("Declined", DECLINED);
    await owner("Silent");
    // Not even handed to the adapter.
    expect(tracking.events).toEqual([]);
    expect(tracking.rejected).toEqual([]);
  });

  it("does not fire when a trial is refused", async () => {
    const { user } = await owner("Twice", GA_COOKIES);
    tracking.clear();
    const again = await call(createWorkspace, {
      body: { name: "Second" },
      cookie: withCookies(user, GA_COOKIES),
    });
    expect(again.status).not.toBe(201);
    expect(tracking.events).toEqual([]);
  });
});

describe("payment_succeeded and subscription_activated", () => {
  it("verify activation emits the pair once with the consented ids; repeats and the webhook replay emit nothing", async () => {
    const { user, organizationId } = await owner("Verify");
    const s = await startCheckout(user, organizationId, GA_COOKIES);
    const paymentId = fake.capture(s.orderId);
    tracking.clear();

    expect((await verifyAs(user, organizationId, s, paymentId, GA_COOKIES)).status).toBe(200);
    expect(tracking.events).toEqual([
      { event: paid(s.amountMinor, false), context: { analytics: BROWSER } },
      { event: activated, context: { analytics: BROWSER } },
    ]);

    // A refresh of the success page, a client retry, and the provider's own webhook afterwards.
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);
    const late = await postWebhook(s, paymentId);
    expect(late.body.data?.outcome).toBe("already_paid");
    expect(names()).toEqual(["payment_succeeded", "subscription_activated"]);
    // The stored opt-in is not kept once the payment is confirmed.
    expect(await storedClientId(s)).toBeNull();
  });

  it("verify sends nothing when the browser has withdrawn by then, though it allowed analytics at checkout", async () => {
    const { user, organizationId } = await owner("Withdrawn");
    const s = await startCheckout(user, organizationId, GA_COOKIES);
    const paymentId = fake.capture(s.orderId);
    tracking.clear();

    expect((await verifyAs(user, organizationId, s, paymentId, DECLINED)).status).toBe(200);
    expect((await postWebhook(s, paymentId)).body.data?.outcome).toBe("already_paid");
    expect(tracking.events).toEqual([]);
    expect(await storedClientId(s)).toBeNull();
  });

  it("webhook activation carries the checkout's opt-in: sent once with the stored client id; a duplicate delivery and a later verify emit nothing", async () => {
    const { user, organizationId } = await owner("Hook");
    const s = await startCheckout(user, organizationId, GA_COOKIES);
    expect(await storedClientId(s)).toBe(BROWSER.clientId);
    const paymentId = fake.capture(s.orderId);
    tracking.clear();

    const first = await postWebhook(s, paymentId, "evt_trk_dup");
    expect(first.body.data?.outcome).toBe("activated");
    const replay = await postWebhook(s, paymentId, "evt_trk_dup");
    expect(replay.body.data?.outcome).toBe("duplicate");
    const other = await postWebhook(s, paymentId);
    expect(other.body.data?.outcome).toBe("already_paid");
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);

    expect(tracking.events).toEqual([
      { event: paid(s.amountMinor, false), context: { analytics: STORED } },
      { event: activated, context: { analytics: STORED } },
    ]);
    expect(await storedClientId(s)).toBeNull();
  });

  it.each([
    ["declined", "Declining", DECLINED],
    ["never chose", "Undecided", undefined],
  ])(
    "a webhook for a checkout whose buyer %s sends nothing and stores no id",
    async (_label, name, cookie) => {
      const { user, organizationId } = await owner(name);
      const s = await startCheckout(user, organizationId, cookie);
      expect(await storedClientId(s)).toBeNull();
      const paymentId = fake.capture(s.orderId);
      tracking.clear();
      expect((await postWebhook(s, paymentId)).body.data?.outcome).toBe("activated");
      expect(tracking.events).toEqual([]);
      expect(tracking.rejected).toEqual([]);
    },
  );

  it("a renewal is labelled and is not a new activation", async () => {
    const { user, organizationId } = await owner("Renew");
    const first = await startCheckout(user, organizationId, GA_COOKIES);
    await verifyAs(user, organizationId, first, fake.capture(first.orderId), GA_COOKIES);
    tracking.clear();

    const again = await startCheckout(user, organizationId, GA_COOKIES);
    const res = await verifyAs(
      user,
      organizationId,
      again,
      fake.capture(again.orderId),
      GA_COOKIES,
    );
    expect(res.status).toBe(200);
    expect(tracking.events).toEqual([
      { event: paid(again.amountMinor, true), context: { analytics: BROWSER } },
    ]);
  });

  it("a payment that does not match never emits", async () => {
    const { user, organizationId } = await owner("Short");
    const s = await startCheckout(user, organizationId, GA_COOKIES);
    const paymentId = fake.capture(s.orderId, s.amountMinor - 1);
    tracking.clear();
    await verifyAs(user, organizationId, s, paymentId, GA_COOKIES);
    expect(tracking.events).toEqual([]);
  });
});

describe("Super Admin actions", () => {
  it("manual activation and cancellation send nothing, even when the admin's own browser opted in", async () => {
    const { ws } = await owner("Manual", GA_COOKIES);
    tracking.clear();
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const activatedRes = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: `${admin.cookie}; ${GA_COOKIES}`,
      body: { planKey: "pro", billingCycle: "ANNUAL", periodEnd },
    });
    expect(activatedRes.status).toBe(200);
    const cancelled = await call(cancel, {
      params: { workspaceId: ws.id },
      cookie: `${admin.cookie}; ${GA_COOKIES}`,
      body: { reason: "Customer asked to stop" },
    });
    expect(cancelled.status).toBe(200);
    expect(tracking.events).toEqual([]);
    expect(tracking.rejected).toEqual([]);
  });
});

describe("retention of a stored opt-in", () => {
  it("the scheduled sweep forgets an unpaid checkout's client id after 48 hours", async () => {
    const { user, organizationId } = await owner("Abandoned");
    const s = await startCheckout(user, organizationId, GA_COOKIES);
    const previousSecret = c.env.CRON_SECRET;
    c.env.CRON_SECRET = "cron-secret-for-tracking-tests";
    const sweep = () =>
      call<{ analyticsIdsCleared: number }>(runJob, {
        method: "POST",
        headers: { authorization: `Bearer ${c.env.CRON_SECRET}` },
      });
    try {
      expect((await sweep()).status).toBe(200);
      // A checkout still within its payment window keeps the id for the webhook.
      expect(await storedClientId(s)).toBe(BROWSER.clientId);

      c.clock.setOffsetMs(49 * 3_600_000);
      const later = await sweep();
      expect(later.body.data!.analyticsIdsCleared).toBeGreaterThanOrEqual(1);
      expect(await storedClientId(s)).toBeNull();
    } finally {
      c.clock.setOffsetMs(0);
      c.env.CRON_SECRET = previousSecret;
    }
  });
});

describe("failure isolation", () => {
  it("an adapter that throws never breaks the business operation", async () => {
    const original = c.tracking.track;
    let calls = 0;
    c.tracking.track = () => {
      calls++;
      throw new Error("adapter exploded");
    };
    try {
      const user = await signUpUser("Exploding Owner");
      const res = await call<{ id: string }>(createWorkspace, {
        body: { name: "Exploding Kitchen" },
        cookie: withCookies(user, GA_COOKIES),
      });
      expect(res.status).toBe(201);
      // The opted-in owner's trial_started reached the throwing adapter.
      expect(calls).toBe(1);
    } finally {
      c.tracking.track = original;
    }
  });
});
