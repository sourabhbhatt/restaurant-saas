import { createHash, randomUUID } from "node:crypto";

import type {
  CheckoutSessionDto,
  CheckoutVerifyDto,
  CreateCheckoutInput,
  PaymentOrderDto,
  VerifyCheckoutInput,
  WebhookResultDto,
} from "@ros/contracts/payments";
import { paidPeriodFor } from "@ros/domain/payments/period";
import { DomainError, notFound } from "@ros/domain/shared/errors";
import type { BillingCycle } from "@ros/domain/subscriptions/entitlements";
import type { TransactionRunner } from "@ros/database/interfaces/transaction";
import type { PaymentGateway } from "../../ports/payment-gateway";
import { noServerTracking, trackSafely, type ServerTracking } from "../../ports/server-tracking";
import {
  majorUnits,
  storedAnalyticsIds,
  trackingBillingCycle,
  type AnalyticsIds,
} from "@ros/contracts/tracking-events";

import { recordAudit } from "../../audit/audit-service";
import { auditActorFor, type AuditActor, type RequestMeta, type UserActor } from "../../context";
import type { Clock, Logger } from "../../ports/observability";
import type { PaymentOrderRow, PaymentRepos, PaymentRepository } from "./ports";

export interface PaymentServiceDeps {
  /** System runner: orders, events and the subscription are written outside any tenant scope. */
  tx: TransactionRunner<PaymentRepos>;
  /** Tenant runner: the membership check sees only the caller's own rows. */
  membership: TransactionRunner<{ payments: Pick<PaymentRepository, "findMembership"> }>;
  /** Null when PAYMENT_PROVIDER=none: every endpoint then answers 404. */
  gateway: PaymentGateway | null;
  /** Publishable key handed to the checkout page. */
  keyId: string | null;
  clock: Clock;
  logger: Logger;
  /** Growth events, sent once per order on its first activation. Default: none. */
  tracking?: ServerTracking;
}

/** Webhook events that confirm money reached us; everything else is acknowledged and ignored. */
const PAID_EVENTS = new Set(["order.paid", "payment.captured"]);
/** A failed attempt: audited, but the order stays open because Razorpay lets the customer retry on it. */
const FAILED_EVENT = "payment.failed";
/** Every event type that names one of our orders and so takes the order lock. */
const ORDER_EVENTS = new Set([...PAID_EVENTS, FAILED_EVENT]);
/** How long an unpaid checkout keeps its buyer's GA4 client id (privacy policy: at most 48 hours). */
const ANALYTICS_ID_RETENTION_MS = 48 * 60 * 60 * 1000;

interface WebhookPayment {
  paymentId: string | null;
  orderId: string | null;
  amountMinor: number | null;
  currency: string | null;
  status: string | null;
  /** Present on `payment.failed` only; Razorpay's own wording, safe to audit. */
  errorCode: string | null;
  errorDescription: string | null;
  errorReason: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toOrderDto(o: PaymentOrderRow): PaymentOrderDto {
  return {
    id: o.id,
    provider: o.provider,
    providerOrderId: o.providerOrderId,
    planKey: o.planKey,
    billingCycle: o.billingCycle,
    amountMinor: o.amountMinor,
    currency: o.currency,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    paidAt: iso(o.paidAt),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/** The payment entity of an `order.paid` / `payment.captured` / `payment.failed` event, defensively read. */
export function readWebhookPayment(payload: unknown): WebhookPayment {
  const root = (payload ?? {}) as { payload?: { payment?: { entity?: Record<string, unknown> } } };
  const p = root.payload?.payment?.entity ?? {};
  return {
    paymentId: str(p.id),
    orderId: str(p.order_id),
    amountMinor: int(p.amount),
    currency: str(p.currency),
    status: str(p.status),
    errorCode: str(p.error_code),
    errorDescription: str(p.error_description),
    errorReason: str(p.error_reason),
  };
}

export function createPaymentService({
  tx,
  membership,
  gateway,
  keyId,
  clock,
  logger,
  tracking = noServerTracking,
}: PaymentServiceDeps) {
  /**
   * Called after the activating transaction committed; replays never reach
   * it. Sends nothing unless the buyer opted in (`analytics`). A renewal is
   * labelled on the payment and is not counted as a new activation.
   */
  function trackActivation(
    order: PaymentOrderRow,
    analytics: AnalyticsIds | null | undefined,
    renewal: boolean,
  ): void {
    const cycle = trackingBillingCycle(order.billingCycle);
    trackSafely(
      tracking,
      logger,
      {
        name: "payment_succeeded",
        params: {
          plan_key: order.planKey,
          billing_cycle: cycle,
          value: majorUnits(order.amountMinor, order.currency),
          currency: order.currency,
          renewal,
        },
      },
      analytics,
    );
    if (!renewal)
      trackSafely(
        tracking,
        logger,
        {
          name: "subscription_activated",
          params: { plan_key: order.planKey, billing_cycle: cycle },
        },
        analytics,
      );
  }

  function requireGateway(): PaymentGateway {
    // Hidden, not forbidden: with no provider the endpoints do not exist.
    if (!gateway || !keyId) throw notFound("Online payment");
    return gateway;
  }

  /** The caller must be an OWNER or BILLING_ADMIN of the organization; everyone else gets 404. */
  async function requireBillingMember(actor: UserActor, organizationId: string): Promise<void> {
    const member = await membership.read((r) =>
      r.payments.findMembership(organizationId, actor.userId),
    );
    if (!member) throw notFound("Organization");
  }

  function priceFor(
    plan: { monthlyPrice: number | null; annualPrice: number | null },
    cycle: BillingCycle,
  ): number | null {
    return cycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice;
  }

  /**
   * Activates the plan the order paid for: retires the current subscription,
   * inserts the new ACTIVE one (same repository path as Super Admin
   * activation), records the subscription event and the audit, and marks the
   * order PAID. The caller holds the order lock and has checked the amount.
   */
  async function activateInTx(
    r: PaymentRepos,
    order: PaymentOrderRow,
    paymentId: string,
    actor: AuditActor,
  ): Promise<{ subscriptionId: string; periodEnd: Date; renewal: boolean }> {
    const now = clock.now();
    const plan = await r.platform.findPlanById(order.planId);
    if (!plan) throw new Error(`payment order ${order.id}: plan ${order.planId} missing`);
    const ws = await r.payments.findBillingWorkspace(order.organizationId);
    if (!ws) throw new Error(`payment order ${order.id}: organization has no workspace`);

    const old = await r.platform.findCurrentSubscription(ws.id);
    const period = paidPeriodFor(old, order.billingCycle, now);
    await r.platform.retireCurrentSubscription(ws.id);
    const subscriptionId = await r.platform.insertSubscription({
      workspaceId: ws.id,
      planId: plan.id,
      status: "ACTIVE",
      billingCycle: order.billingCycle,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      notes: `Paid online (${order.provider} order ${order.providerOrderId})`,
      activatedBy: order.createdBy,
    });
    await r.platform.insertSubscriptionEvent({
      workspaceId: ws.id,
      subscriptionId,
      type: "paid",
      fromStatus: old?.status ?? null,
      toStatus: "ACTIVE",
      planKey: plan.key,
      actorUserId: order.createdBy,
      metadata: {
        billingCycle: order.billingCycle,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        previousPlanKey: old?.planKey ?? null,
        provider: order.provider,
        paymentOrderId: order.id,
        providerOrderId: order.providerOrderId,
        amountMinor: order.amountMinor,
        currency: order.currency,
      },
    });
    await r.payments.markOrder(order.id, {
      status: "PAID",
      providerPaymentId: paymentId,
      paidAt: now,
      // Only needed until this activation's growth events are sent (from the row in memory).
      analyticsClientId: null,
    });
    await recordAudit(
      r.audit,
      actor,
      "subscription.paid",
      { workspaceId: ws.id, targetType: "subscription", targetId: subscriptionId },
      {
        organizationId: order.organizationId,
        paymentOrderId: order.id,
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        providerPaymentId: paymentId,
        planKey: plan.key,
        billingCycle: order.billingCycle,
        amountMinor: order.amountMinor,
        currency: order.currency,
        periodEnd: period.end.toISOString(),
        previousSubscriptionId: old?.id ?? null,
      },
    );
    const owners = await r.platform.listWorkspaceOwners(ws.id);
    await r.platform.notify(
      owners.map((o) => o.userId),
      ws.id,
      {
        type: "subscription.activated",
        title: `${plan.name} plan activated`,
        body: `Payment received. Your subscription is active until ${period.end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`,
        data: { workspaceId: ws.id, planKey: plan.key },
      },
    );
    // A paid period was still running: a renewal (or a plan change), not a new activation. A
    // lapsed plan can still read ACTIVE (the sweep does not change it), so the date decides.
    const renewal =
      old?.status === "ACTIVE" &&
      old.currentPeriodEnd !== null &&
      old.currentPeriodEnd.getTime() > now.getTime();
    return { subscriptionId, periodEnd: period.end, renewal };
  }

  /**
   * The stored GA4 client id, only while it may be used: within 48 hours of the
   * checkout (privacy policy). The limit holds here even if no cleanup has run.
   */
  function usableAnalyticsId(order: PaymentOrderRow, now: Date): string | null {
    if (!order.analyticsClientId) return null;
    return now.getTime() - order.createdAt.getTime() < ANALYTICS_ID_RETENTION_MS
      ? order.analyticsClientId
      : null;
  }

  /** A locked order carrying an over-age id: delete it (and any other over-age ones) now. */
  /**
   * Clears an over-age analytics id on the order this transaction holds locked,
   * and only that one: touching other tenants' rows under a FOR UPDATE lock
   * could deadlock two late deliveries. The cross-order sweep belongs to
   * `forgetAbandonedAnalyticsIds` (the hourly job).
   */
  async function forgetIfOverAge(r: PaymentRepos, order: PaymentOrderRow): Promise<void> {
    if (order.analyticsClientId && !usableAnalyticsId(order, clock.now()))
      await r.payments.markOrder(order.id, { status: order.status, analyticsClientId: null });
  }

  async function auditMismatch(
    r: PaymentRepos,
    order: PaymentOrderRow,
    actor: AuditActor,
    seen: { paymentId: string | null; amountMinor: number | null; currency: string | null },
    source: "webhook" | "verify",
  ): Promise<void> {
    const ws = await r.payments.findBillingWorkspace(order.organizationId);
    await recordAudit(
      r.audit,
      actor,
      "payment.amount_mismatch",
      { workspaceId: ws?.id ?? null, targetType: "payment_order", targetId: order.id },
      {
        organizationId: order.organizationId,
        source,
        providerOrderId: order.providerOrderId,
        providerPaymentId: seen.paymentId,
        expectedAmountMinor: order.amountMinor,
        expectedCurrency: order.currency,
        receivedAmountMinor: seen.amountMinor,
        receivedCurrency: seen.currency,
      },
    );
    logger.warn("payment_amount_mismatch", {
      paymentOrderId: order.id,
      source,
      expectedAmountMinor: order.amountMinor,
      receivedAmountMinor: seen.amountMinor,
    });
  }

  /**
   * A `payment.failed` for an open order: audited for support, with the order
   * left CREATED so the customer's retry on the same order can still activate.
   */
  async function auditFailure(
    r: PaymentRepos,
    order: PaymentOrderRow,
    actor: AuditActor,
    payment: WebhookPayment,
  ): Promise<void> {
    const ws = await r.payments.findBillingWorkspace(order.organizationId);
    await recordAudit(
      r.audit,
      actor,
      "payment.failed",
      { workspaceId: ws?.id ?? null, targetType: "payment_order", targetId: order.id },
      {
        organizationId: order.organizationId,
        providerOrderId: order.providerOrderId,
        providerPaymentId: payment.paymentId,
        planKey: order.planKey,
        billingCycle: order.billingCycle,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        errorCode: payment.errorCode,
        errorDescription: payment.errorDescription,
        errorReason: payment.errorReason,
      },
    );
    logger.info("payment_failed", {
      paymentOrderId: order.id,
      providerPaymentId: payment.paymentId,
      errorCode: payment.errorCode,
      errorReason: payment.errorReason,
    });
  }

  const amountMatches = (
    order: PaymentOrderRow,
    seen: { amountMinor: number | null; currency: string | null },
  ) => seen.amountMinor === order.amountMinor && seen.currency === order.currency;

  return {
    /**
     * Scheduled with the subscription sweep: a checkout that was never paid
     * keeps its buyer's GA4 client id for at most 48 hours (longer than the
     * provider retries a webhook), then forgets it. Works without a gateway.
     */
    async forgetAbandonedAnalyticsIds(): Promise<{ analyticsIdsCleared: number }> {
      const cutoff = new Date(clock.now().getTime() - ANALYTICS_ID_RETENTION_MS);
      const analyticsIdsCleared = await tx.run((r) => r.payments.forgetAnalyticsIds(cutoff));
      return { analyticsIdsCleared };
    },

    /**
     * Creates a provider order for one billing period of `planKey`. The amount
     * is the plan's own price; the client never sends one.
     */
    async createCheckout(
      actor: UserActor,
      organizationId: string,
      input: CreateCheckoutInput,
      meta: RequestMeta,
    ): Promise<CheckoutSessionDto> {
      const gw = requireGateway();
      await requireBillingMember(actor, organizationId);
      const { org, plan, amountMinor } = await tx.read(async (r) => {
        const org = await r.payments.findOrganization(organizationId);
        if (!org) throw notFound("Organization");
        if (org.status !== "ACTIVE")
          throw new DomainError("CONFLICT", "This organization is suspended. Contact support.");
        const plan = await r.platform.findPlanByKey(input.planKey);
        if (!plan || plan.status !== "ACTIVE" || !plan.isPublic) {
          throw new DomainError("VALIDATION_FAILED", "Choose one of the available plans", {
            fieldErrors: { planKey: ["Choose one of the available plans"] },
          });
        }
        const amountMinor = priceFor(plan, input.billingCycle);
        if (amountMinor === null || amountMinor <= 0) {
          throw new DomainError("VALIDATION_FAILED", "This plan is not sold online", {
            fieldErrors: { planKey: ["This plan is not sold online. Contact us instead."] },
          });
        }
        // A new period is appended after the current paid one (no proration), so a
        // different plan or cycle would silently convert the time already paid for.
        const ws = await r.payments.findBillingWorkspace(organizationId);
        const current = ws ? await r.platform.findCurrentSubscription(ws.id) : null;
        const paidUntil =
          current && (current.status === "ACTIVE" || current.status === "CANCELLED")
            ? current.currentPeriodEnd
            : null;
        if (
          paidUntil &&
          paidUntil.getTime() > clock.now().getTime() &&
          (current!.planId !== plan.id || current!.billingCycle !== input.billingCycle)
        ) {
          throw new DomainError(
            "CONFLICT",
            `Your current plan is paid until ${paidUntil.toISOString().slice(0, 10)}. You can renew it now; to change plan or billing cycle before then, contact support.`,
          );
        }
        return { org, plan, amountMinor };
      });

      const paymentOrderId = randomUUID();
      const { orderId } = await gw.createOrder({
        amountMinor,
        currency: plan.currency,
        receipt: paymentOrderId,
        notes: {
          organizationId,
          planKey: plan.key,
          billingCycle: input.billingCycle,
          paymentOrderId,
        },
      });
      await tx.run(async (r) => {
        const ws = await r.payments.findBillingWorkspace(organizationId);
        await r.payments.insertOrder({
          id: paymentOrderId,
          organizationId,
          provider: gw.name,
          providerOrderId: orderId,
          planId: plan.id,
          billingCycle: input.billingCycle,
          amountMinor,
          currency: plan.currency,
          createdBy: actor.userId,
          // Kept only with the buyer's opt-in, for a payment the webhook confirms.
          analyticsClientId: meta.analytics?.clientId ?? null,
        });
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "payment.checkout_created",
          { workspaceId: ws?.id ?? null, targetType: "payment_order", targetId: paymentOrderId },
          {
            organizationId,
            provider: gw.name,
            providerOrderId: orderId,
            planKey: plan.key,
            billingCycle: input.billingCycle,
            amountMinor,
            currency: plan.currency,
          },
        );
      });
      return {
        provider: gw.name,
        keyId: keyId!,
        orderId,
        paymentOrderId,
        amountMinor,
        currency: plan.currency,
        planKey: plan.key,
        planName: plan.name,
        billingCycle: input.billingCycle,
        organizationName: org.name,
      };
    },

    /**
     * The checkout callback. Activation needs both the callback signature and
     * a captured payment of the right amount fetched from the provider; the
     * signature alone proves only that Checkout closed.
     */
    async verifyCheckout(
      actor: UserActor,
      organizationId: string,
      input: VerifyCheckoutInput,
      meta: RequestMeta,
    ): Promise<CheckoutVerifyDto> {
      const gw = requireGateway();
      await requireBillingMember(actor, organizationId);
      const existing = await tx.read((r) => r.payments.findOrder(gw.name, input.razorpayOrderId));
      if (!existing || existing.organizationId !== organizationId) throw notFound("Payment order");
      if (
        !gw.verifyPaymentSignature({
          orderId: input.razorpayOrderId,
          paymentId: input.razorpayPaymentId,
          signature: input.razorpaySignature,
        })
      ) {
        logger.warn("payment_signature_invalid", {
          source: "verify",
          paymentOrderId: existing.id,
          requestId: meta.requestId,
        });
        throw new DomainError("UNAUTHENTICATED", "Payment signature is invalid");
      }
      const actorFor = auditActorFor(actor, meta);
      const payments =
        existing.status === "PAID" ? [] : await gw.fetchOrderPayments(input.razorpayOrderId);
      const captured = payments.filter((p) => p.status === "captured");

      const won: { order?: PaymentOrderRow; renewal?: boolean } = {};
      const result = await tx.run(async (r) => {
        won.order = undefined;
        const order = await r.payments.lockOrder(gw.name, input.razorpayOrderId);
        if (!order) throw notFound("Payment order");
        await forgetIfOverAge(r, order);
        const current = async (status: CheckoutVerifyDto["status"], periodEnd: Date | null) => ({
          status,
          order: toOrderDto((await r.payments.findOrder(gw.name, input.razorpayOrderId)) ?? order),
          currentPeriodEnd: iso(periodEnd),
        });
        if (order.status === "PAID") {
          const ws = await r.payments.findBillingWorkspace(order.organizationId);
          const sub = ws ? await r.platform.findCurrentSubscription(ws.id) : null;
          return current("ACTIVE", sub?.currentPeriodEnd ?? null);
        }
        const match = captured.find((p) => amountMatches(order, p));
        if (!match) {
          const wrong = captured[0];
          if (wrong) await auditMismatch(r, order, actorFor, wrong, "verify");
          return current("PENDING", null);
        }
        const { periodEnd, renewal } = await activateInTx(r, order, match.paymentId, actorFor);
        won.order = order;
        won.renewal = renewal;
        return current("ACTIVE", periodEnd);
      });
      // This browser's current choice decides: nothing if it has declined since the checkout.
      if (won.order) trackActivation(won.order, meta.analytics, won.renewal === true);
      return result;
    },

    /**
     * Provider webhook. The signature is checked on the raw body before the
     * JSON is parsed; a bad one is 401 with nothing of the body logged. Every
     * verified delivery is recorded once by event id, then answered 2xx.
     */
    async handleWebhook(
      input: { rawBody: string; signature: string | null; eventId: string | null },
      meta: RequestMeta,
    ): Promise<WebhookResultDto> {
      const gw = requireGateway();
      if (!input.signature || !gw.verifyWebhookSignature(input.rawBody, input.signature)) {
        logger.warn("payment_signature_invalid", { source: "webhook", requestId: meta.requestId });
        throw new DomainError("UNAUTHENTICATED", "Webhook signature is invalid");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(input.rawBody);
      } catch {
        throw new DomainError("BAD_REQUEST", "Malformed webhook body");
      }
      const type = str((payload as { event?: unknown })?.event) ?? "unknown";
      const payloadHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");
      // Razorpay sends x-razorpay-event-id; without it the body hash stands in.
      const eventId = input.eventId ?? payloadHash;
      const payment = readWebhookPayment(payload);
      const actor: AuditActor = { type: "SYSTEM", userId: null, requestId: meta.requestId };

      const won: { order?: PaymentOrderRow; renewal?: boolean } = {};
      const outcome = await tx.run(async (r): Promise<WebhookResultDto["outcome"]> => {
        won.order = undefined;
        // The order row is locked FOR UPDATE before the event is recorded, so a webhook
        // and the verify endpoint (or two deliveries) serialise on one order.
        const order =
          ORDER_EVENTS.has(type) && payment.orderId
            ? await r.payments.lockOrder(gw.name, payment.orderId)
            : null;
        if (order) await forgetIfOverAge(r, order);
        const fresh = await r.payments.insertEvent({
          provider: gw.name,
          eventId,
          organizationId: order?.organizationId ?? null,
          type,
          payloadHash,
        });
        if (!fresh) return "duplicate";
        if (!ORDER_EVENTS.has(type)) return "ignored";
        if (!order) return "unknown_order";
        if (order.status === "PAID") return "already_paid";
        if (type === FAILED_EVENT) {
          await auditFailure(r, order, actor, payment);
          return "failed_recorded";
        }
        // order.paid carries the payment entity too; only a captured payment is money in hand.
        if (payment.status !== "captured") {
          logger.info("payment_webhook_not_captured", {
            type,
            paymentOrderId: order.id,
            paymentStatus: payment.status,
            requestId: meta.requestId,
          });
          return "ignored";
        }
        if (!payment.paymentId || !amountMatches(order, payment)) {
          await auditMismatch(r, order, actor, payment, "webhook");
          return "mismatch";
        }
        won.renewal = (await activateInTx(r, order, payment.paymentId, actor)).renewal;
        won.order = order;
        return "activated";
      });
      // Only `activated`: duplicate, already_paid, mismatch and replays never emit. The provider's
      // request carries no browser: the opt-in recorded with the checkout decides (none: nothing).
      if (outcome === "activated" && won.order)
        trackActivation(
          won.order,
          storedAnalyticsIds(usableAnalyticsId(won.order, clock.now())),
          won.renewal === true,
        );
      logger.info("payment_webhook_handled", { type, outcome, requestId: meta.requestId });
      return { received: true, outcome };
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
