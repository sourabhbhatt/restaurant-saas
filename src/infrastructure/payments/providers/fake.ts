import type { GatewayPayment, PaymentGateway } from "@/server/ports/payment-gateway";

import { hmacSha256Hex, signatureMatches } from "../hmac";

export interface FakeOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
  payments: GatewayPayment[];
}

export interface FakePaymentGateway extends PaymentGateway {
  readonly orders: Map<string, FakeOrder>;
  /** Records a payment against an order the way Razorpay would after checkout. */
  capture(orderId: string, amountMinor?: number, status?: GatewayPayment["status"]): string;
  /** What checkout.js hands the page's handler. */
  signPayment(orderId: string, paymentId: string): string;
  /** The `X-Razorpay-Signature` header for a raw webhook body. */
  signWebhook(rawBody: string): string;
}

/**
 * In-memory gateway for tests: orders live in a map, payments are captured
 * on demand, and both signatures use real HMACs with the configured secrets.
 */
export function createFakePaymentGateway(secrets: {
  keySecret: string;
  webhookSecret: string;
}): FakePaymentGateway {
  const orders = new Map<string, FakeOrder>();
  let sequence = 0;
  return {
    name: "fake",
    orders,
    async createOrder(input) {
      sequence += 1;
      const orderId = `order_fake${sequence.toString().padStart(6, "0")}`;
      orders.set(orderId, { orderId, ...input, payments: [] });
      return { orderId };
    },
    async fetchOrderPayments(orderId) {
      return [...(orders.get(orderId)?.payments ?? [])];
    },
    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return signatureMatches(
        hmacSha256Hex(secrets.keySecret, `${orderId}|${paymentId}`),
        signature,
      );
    },
    verifyWebhookSignature(rawBody, signature) {
      return signatureMatches(hmacSha256Hex(secrets.webhookSecret, rawBody), signature);
    },
    capture(orderId, amountMinor, status = "captured") {
      const order = orders.get(orderId);
      if (!order) throw new Error(`fake gateway: unknown order ${orderId}`);
      sequence += 1;
      const paymentId = `pay_fake${sequence.toString().padStart(6, "0")}`;
      order.payments.push({
        paymentId,
        status,
        amountMinor: amountMinor ?? order.amountMinor,
        currency: order.currency,
      });
      return paymentId;
    },
    signPayment(orderId, paymentId) {
      return hmacSha256Hex(secrets.keySecret, `${orderId}|${paymentId}`);
    },
    signWebhook(rawBody) {
      return hmacSha256Hex(secrets.webhookSecret, rawBody);
    },
  };
}
