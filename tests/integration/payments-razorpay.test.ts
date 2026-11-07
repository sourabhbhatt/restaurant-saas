import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as checkout } from "@/app/api/v1/organizations/[organizationId]/checkout/route";
import { POST as verify } from "@/app/api/v1/organizations/[organizationId]/checkout/verify/route";
import { POST as webhook } from "@/app/api/v1/webhooks/razorpay/route";
import { GET as getSubscription } from "@/app/api/v1/workspaces/[workspaceId]/subscription/route";
import type { CheckoutSessionDto, CheckoutVerifyDto, WebhookResultDto } from "@/contracts/payments";
import type { SubscriptionOverviewDto } from "@/contracts/platform";
import { addBillingCycle } from "@/domain/payments/period";
import type { DbContext } from "@/infrastructure/database/interfaces/transaction";
import {
  createTenantRunner,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import {
  auditLogs,
  paymentEvents,
  paymentOrders,
  subscriptionEvents,
  subscriptionPlans,
  subscriptions,
} from "@/infrastructure/database/providers/postgres/schema";
import { createFakePaymentGateway } from "@/infrastructure/payments/providers/fake";
import { setContainerForTests, type Container } from "@/server/container";
import { createWorkspaceAs, organizationOf, signUpUser, type TestUser } from "@/test/fixtures";
import { signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

const SECRETS = { keySecret: "key-secret-for-tests", webhookSecret: "webhook-secret-for-tests" };
const fake = createFakePaymentGateway(SECRETS);

let c: Container;
let admin: TestUser;
let proMonthly: number;
let proAnnual: number;

beforeAll(async () => {
  // Only the publishable id reaches the container; the gateway itself is the fake.
  process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
  c = await createTestContainer({ payments: fake });
  admin = await signUpAdmin(c);
  const [pro] = await c.db
    .select({ monthly: subscriptionPlans.monthlyPrice, annual: subscriptionPlans.annualPrice })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.key, "pro"));
  proMonthly = pro!.monthly!;
  proAnnual = pro!.annual!;
});
afterAll(async () => {
  delete process.env.RAZORPAY_KEY_ID;
  await c.close();
});

async function orgOwner(name: string) {
  const owner = await signUpUser(`${name} Owner`);
  const ws = await createWorkspaceAs(owner, `${name} Kitchen`);
  return { owner, ws, organizationId: await organizationOf(c, ws.id) };
}

async function createCheckout(
  owner: TestUser,
  organizationId: string,
  body: Record<string, unknown> = { planKey: "pro", billingCycle: "MONTHLY" },
) {
  const res = await call<CheckoutSessionDto>(checkout, {
    params: { organizationId },
    cookie: owner.cookie,
    body,
  });
  expect(res.status).toBe(201);
  return res.body.data!;
}

function paidEvent(
  session: CheckoutSessionDto,
  over: Partial<{ amount: number; currency: string; event: string; paymentId: string }> = {},
) {
  return {
    entity: "event",
    event: over.event ?? "order.paid",
    contains: ["payment", "order"],
    payload: {
      payment: {
        entity: {
          id: over.paymentId ?? `pay_${session.orderId.slice(-6)}`,
          entity: "payment",
          amount: over.amount ?? session.amountMinor,
          currency: over.currency ?? session.currency,
          status: "captured",
          order_id: session.orderId,
        },
      },
      order: { entity: { id: session.orderId, amount: session.amountMinor, status: "paid" } },
    },
    created_at: 1_800_000_000,
  };
}

let eventSeq = 0;
async function postWebhook(body: unknown, opts: { signature?: string; eventId?: string } = {}) {
  const raw = JSON.stringify(body);
  eventSeq += 1;
  return call<WebhookResultDto>(webhook, {
    path: "/api/v1/webhooks/razorpay",
    body,
    origin: "https://api.razorpay.com",
    headers: {
      "x-razorpay-signature": opts.signature ?? fake.signWebhook(raw),
      "x-razorpay-event-id": opts.eventId ?? `evt_${eventSeq}`,
    },
  });
}

async function currentSubscription(organizationId: string) {
  const [row] = await c.db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      planKey: subscriptionPlans.key,
      billingCycle: subscriptions.billingCycle,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
    .where(
      and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.isCurrent, true)),
    );
  return row!;
}

async function orderRow(providerOrderId: string) {
  const [row] = await c.db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.providerOrderId, providerOrderId));
  return row!;
}

async function auditCount(action: string, targetId: string) {
  const rows = await c.db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)));
  return rows.length;
}

async function verifyAs(
  owner: TestUser,
  organizationId: string,
  session: CheckoutSessionDto,
  paymentId: string,
  signature?: string,
) {
  return call<CheckoutVerifyDto>(verify, {
    params: { organizationId },
    cookie: owner.cookie,
    body: {
      razorpayOrderId: session.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature ?? fake.signPayment(session.orderId, paymentId),
    },
  });
}

describe("checkout", () => {
  it("uses the server price, not client input, and never returns a secret", async () => {
    const { owner, ws, organizationId } = await orgOwner("Price");
    const res = await call<CheckoutSessionDto>(checkout, {
      params: { organizationId },
      cookie: owner.cookie,
      body: { planKey: "pro", billingCycle: "ANNUAL", amountMinor: 1, amount: 1 },
    });
    expect(res.status).toBe(201);
    const session = res.body.data!;
    expect(session).toMatchObject({
      provider: "fake",
      keyId: "rzp_test_fake",
      amountMinor: proAnnual,
      currency: "INR",
      planKey: "pro",
      billingCycle: "ANNUAL",
      organizationName: "Price Kitchen",
    });
    expect(fake.orders.get(session.orderId)).toMatchObject({
      amountMinor: proAnnual,
      receipt: session.paymentOrderId,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRETS.keySecret);
    expect(text).not.toContain(SECRETS.webhookSecret);
    expect(text).not.toMatch(/secret/i);

    const stored = await orderRow(session.orderId);
    expect(stored).toMatchObject({
      organizationId,
      status: "CREATED",
      amountMinor: proAnnual,
      billingCycle: "ANNUAL",
      createdBy: owner.userId,
    });
    expect(await auditCount("payment.checkout_created", session.paymentOrderId)).toBe(1);

    const overview = await call<SubscriptionOverviewDto>(getSubscription, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(overview.body.data).toMatchObject({ organizationId, paymentsEnabled: true });
  });

  it("refuses plans that are not sold online", async () => {
    const { owner, organizationId } = await orgOwner("Enterprise");
    const res = await call(checkout, {
      params: { organizationId },
      cookie: owner.cookie,
      body: { planKey: "enterprise", billingCycle: "MONTHLY" },
    });
    expect(res.status).toBe(422);
    expect(res.body.error?.fieldErrors?.planKey).toBeDefined();
  });

  it("non-owner cannot create checkout (404), nor verify", async () => {
    const { owner, organizationId } = await orgOwner("Guarded");
    const stranger = await signUpUser("Stranger");
    await createWorkspaceAs(stranger, "Stranger Kitchen");
    const res = await call(checkout, {
      params: { organizationId },
      cookie: stranger.cookie,
      body: { planKey: "pro", billingCycle: "MONTHLY" },
    });
    expect(res.status).toBe(404);
    expect(
      await c.db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.organizationId, organizationId)),
    ).toEqual([]);

    const session = await createCheckout(owner, organizationId);
    const paymentId = fake.capture(session.orderId);
    const stolen = await verifyAs(stranger, organizationId, session, paymentId);
    expect(stolen.status).toBe(404);
    expect((await orderRow(session.orderId)).status).toBe("CREATED");

    const anon = await call(checkout, {
      params: { organizationId },
      body: { planKey: "pro", billingCycle: "MONTHLY" },
    });
    expect(anon.status).toBe(401);
  });
});

describe("webhook", () => {
  it("valid webhook activates once; replay is a no-op", async () => {
    const { owner, organizationId } = await orgOwner("Hook");
    const session = await createCheckout(owner, organizationId);
    const before = await currentSubscription(organizationId);
    expect(before.status).toBe("TRIALING");

    const first = await postWebhook(paidEvent(session), { eventId: "evt_hook_1" });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ received: true, outcome: "activated" });

    const sub = await currentSubscription(organizationId);
    expect(sub).toMatchObject({ status: "ACTIVE", planKey: "pro", billingCycle: "MONTHLY" });
    expect(sub.id).not.toBe(before.id);
    expect(sub.currentPeriodEnd!.toISOString()).toBe(
      addBillingCycle(sub.currentPeriodStart!, "MONTHLY").toISOString(),
    );
    const order = await orderRow(session.orderId);
    expect(order).toMatchObject({
      status: "PAID",
      providerPaymentId: `pay_${session.orderId.slice(-6)}`,
    });
    expect(order.paidAt).not.toBeNull();
    expect(await auditCount("subscription.paid", sub.id)).toBe(1);
    const events = await c.db
      .select({ type: subscriptionEvents.type, metadata: subscriptionEvents.metadata })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, sub.id));
    expect(events).toEqual([
      expect.objectContaining({
        type: "paid",
        metadata: expect.objectContaining({ providerOrderId: session.orderId }),
      }),
    ]);

    // Same delivery again (same event id): nothing changes.
    const replay = await postWebhook(paidEvent(session), { eventId: "evt_hook_1" });
    expect(replay.status).toBe(200);
    expect(replay.body.data!.outcome).toBe("duplicate");
    // payment.captured for the same order arrives as its own event: also a no-op.
    const captured = await postWebhook(paidEvent(session, { event: "payment.captured" }), {
      eventId: "evt_hook_2",
    });
    expect(captured.status).toBe(200);
    expect(captured.body.data!.outcome).toBe("already_paid");

    expect((await currentSubscription(organizationId)).id).toBe(sub.id);
    expect(await auditCount("subscription.paid", sub.id)).toBe(1);
    const stored = await c.db
      .select({ eventId: paymentEvents.eventId, organizationId: paymentEvents.organizationId })
      .from(paymentEvents)
      .where(eq(paymentEvents.organizationId, organizationId));
    expect(stored.map((e) => e.eventId).sort()).toEqual(["evt_hook_1", "evt_hook_2"]);
  });

  it("webhook with bad signature is 401 and changes nothing", async () => {
    const { owner, organizationId } = await orgOwner("Forged");
    const session = await createCheckout(owner, organizationId);
    const body = paidEvent(session);
    const forged = await postWebhook(body, {
      signature: fake.signWebhook(JSON.stringify({ ...body, event: "order.paid " })),
      eventId: "evt_forged",
    });
    expect(forged.status).toBe(401);
    const missing = await call(webhook, { body, origin: "https://api.razorpay.com" });
    expect(missing.status).toBe(401);

    expect((await orderRow(session.orderId)).status).toBe("CREATED");
    expect((await currentSubscription(organizationId)).status).toBe("TRIALING");
    expect(
      await c.db.select().from(paymentEvents).where(eq(paymentEvents.eventId, "evt_forged")),
    ).toEqual([]);
  });

  it("amount mismatch never activates", async () => {
    const { owner, organizationId } = await orgOwner("Mismatch");
    const session = await createCheckout(owner, organizationId);
    const res = await postWebhook(paidEvent(session, { amount: session.amountMinor - 100 }));
    expect(res.status).toBe(200);
    expect(res.body.data!.outcome).toBe("mismatch");
    const wrongCurrency = await postWebhook(paidEvent(session, { currency: "USD" }));
    expect(wrongCurrency.body.data!.outcome).toBe("mismatch");

    const order = await orderRow(session.orderId);
    expect(order.status).toBe("CREATED");
    expect((await currentSubscription(organizationId)).status).toBe("TRIALING");
    expect(await auditCount("payment.amount_mismatch", session.paymentOrderId)).toBe(2);
  });

  it("acknowledges ignored event types and unknown orders", async () => {
    const ignored = await postWebhook({ event: "refund.created", payload: {} });
    expect(ignored.status).toBe(200);
    expect(ignored.body.data!.outcome).toBe("ignored");
    const unknown = await postWebhook({
      event: "order.paid",
      payload: {
        payment: { entity: { id: "pay_x", order_id: "order_nope", amount: 1, currency: "INR" } },
      },
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data!.outcome).toBe("unknown_order");
    // The harness JSON-encodes bodies, so a malformed body is built by hand.
    const raw = "{not json";
    const malformed = await webhook(
      new Request("http://localhost:3000/api/v1/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": fake.signWebhook(raw),
          "x-razorpay-event-id": "evt_malformed",
        },
        body: raw,
      }),
      { params: Promise.resolve(undefined) },
    );
    expect(malformed.status).toBe(400);
  });
});

describe("verify endpoint", () => {
  it("requires both a valid signature and a captured payment", async () => {
    const { owner, organizationId } = await orgOwner("Verify");
    const session = await createCheckout(owner, organizationId);

    // Valid signature, but Razorpay knows no captured payment yet.
    const early = await verifyAs(owner, organizationId, session, "pay_early");
    expect(early.status).toBe(200);
    expect(early.body.data!.status).toBe("PENDING");
    expect((await currentSubscription(organizationId)).status).toBe("TRIALING");

    // Captured payment, forged signature.
    const paymentId = fake.capture(session.orderId);
    const forged = await verifyAs(owner, organizationId, session, paymentId, "0".repeat(64));
    expect(forged.status).toBe(401);
    expect((await orderRow(session.orderId)).status).toBe("CREATED");

    // Both: activated.
    const ok = await verifyAs(owner, organizationId, session, paymentId);
    expect(ok.status).toBe(200);
    expect(ok.body.data!.status).toBe("ACTIVE");
    expect(ok.body.data!.order).toMatchObject({ status: "PAID", planKey: "pro" });
    const sub = await currentSubscription(organizationId);
    expect(sub.status).toBe("ACTIVE");
    expect(ok.body.data!.currentPeriodEnd).toBe(sub.currentPeriodEnd!.toISOString());
    expect(await auditCount("subscription.paid", sub.id)).toBe(1);

    // Again: a no-op that still answers ACTIVE; the webhook afterwards is a no-op too.
    const again = await verifyAs(owner, organizationId, session, paymentId);
    expect(again.status).toBe(200);
    expect(again.body.data!.status).toBe("ACTIVE");
    const late = await postWebhook(paidEvent(session, { paymentId }));
    expect(late.body.data!.outcome).toBe("already_paid");
    expect((await currentSubscription(organizationId)).id).toBe(sub.id);
    expect(await auditCount("subscription.paid", sub.id)).toBe(1);
  });

  it("a captured payment of the wrong amount stays pending and is audited", async () => {
    const { owner, organizationId } = await orgOwner("Short");
    const session = await createCheckout(owner, organizationId);
    const paymentId = fake.capture(session.orderId, session.amountMinor - 1);
    const res = await verifyAs(owner, organizationId, session, paymentId);
    expect(res.status).toBe(200);
    expect(res.body.data!.status).toBe("PENDING");
    expect((await orderRow(session.orderId)).status).toBe("CREATED");
    expect(await auditCount("payment.amount_mismatch", session.paymentOrderId)).toBe(1);
  });

  it("renewal extends from current period end", async () => {
    const { owner, ws, organizationId } = await orgOwner("Renew");
    const periodEnd = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
    const activated = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { planKey: "pro", billingCycle: "ANNUAL", periodEnd },
    });
    expect(activated.status).toBe(200);
    const before = await currentSubscription(organizationId);
    expect(before.status).toBe("ACTIVE");
    const oldEnd = before.currentPeriodEnd!;

    const session = await createCheckout(owner, organizationId, {
      planKey: "pro",
      billingCycle: "ANNUAL",
    });
    expect(session.amountMinor).toBe(proAnnual);
    const paymentId = fake.capture(session.orderId);
    const res = await verifyAs(owner, organizationId, session, paymentId);
    expect(res.body.data!.status).toBe("ACTIVE");

    const after = await currentSubscription(organizationId);
    expect(after.id).not.toBe(before.id);
    expect(after.currentPeriodStart!.toISOString()).toBe(oldEnd.toISOString());
    expect(after.currentPeriodEnd!.toISOString()).toBe(
      addBillingCycle(oldEnd, "ANNUAL").toISOString(),
    );
    expect(session.amountMinor).toBe(proAnnual);
    expect(proMonthly).toBeLessThan(proAnnual);
  });
});

describe("row-level security on payment tables", () => {
  function asTenant<T>(context: DbContext, work: (e: Executor) => Promise<T>): Promise<T> {
    return createTenantRunner(c.db, (e) => e, { role: "ros_tenant", context: () => context }).run(
      work,
    );
  }
  const count = async (e: Executor, organizationId: string) =>
    (
      (await e.execute(
        sql`select count(*)::int as n from payment_orders where organization_id = ${organizationId}`,
      )) as unknown as { rows: { n: number }[] }
    ).rows[0]!.n;

  it("tenants read their own organization's orders only, and cannot write", async () => {
    const a = await orgOwner("Rls A");
    const b = await orgOwner("Rls B");
    await createCheckout(a.owner, a.organizationId);
    await createCheckout(b.owner, b.organizationId);
    const ctxA = { workspaceId: a.ws.id, userId: a.owner.userId };
    expect(await asTenant(ctxA, (e) => count(e, a.organizationId))).toBe(1);
    expect(await asTenant(ctxA, (e) => count(e, b.organizationId))).toBe(0);
    const write = await asTenant(ctxA, (e) =>
      e.execute(
        sql`update payment_orders set status = 'PAID' where organization_id = ${a.organizationId}`,
      ),
    ).catch((error: unknown) => error);
    expect(write).toBeInstanceOf(Error);
  });
});

describe("without a gateway", () => {
  it("the checkout endpoints do not exist and the Pay button is off", async () => {
    const plain = await createTestContainer();
    try {
      const { owner, ws, organizationId } = await orgOwner("Offline");
      const res = await call(checkout, {
        params: { organizationId },
        cookie: owner.cookie,
        body: { planKey: "pro", billingCycle: "MONTHLY" },
      });
      expect(res.status).toBe(404);
      const hook = await call(webhook, { body: {}, origin: "https://api.razorpay.com" });
      expect(hook.status).toBe(404);
      const overview = await call<SubscriptionOverviewDto>(getSubscription, {
        params: { workspaceId: ws.id },
        cookie: owner.cookie,
      });
      expect(overview.body.data!.paymentsEnabled).toBe(false);
    } finally {
      await plain.close();
      setContainerForTests(c);
    }
  });
});
