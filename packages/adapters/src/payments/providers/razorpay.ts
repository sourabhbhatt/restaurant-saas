import type { GatewayPayment, PaymentGateway } from "@ros/application/ports/payment-gateway";

import { hmacSha256Hex, signatureMatches } from "../hmac";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Overridable for tests; the live API is https://api.razorpay.com/v1. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface RazorpayOrder {
  id: string;
}

interface RazorpayPaymentEntity {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

interface RazorpayCollection<T> {
  items: T[];
}

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

/**
 * Razorpay Orders API over plain `fetch` with HTTP Basic `key_id:key_secret`.
 * No SDK: the surface we use is two endpoints and two HMACs.
 */
export function createRazorpayGateway(config: RazorpayConfig): PaymentGateway {
  const base = (config.baseUrl ?? "https://api.razorpay.com/v1").replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const err = (payload as { error?: { code?: string; description?: string } } | null)?.error;
      // The description is Razorpay's own wording about the request, never our secret.
      throw new RazorpayApiError(
        res.status,
        err?.code,
        err?.description ?? `Razorpay request failed (${res.status})`,
      );
    }
    return payload as T;
  }

  return {
    name: "razorpay",
    async createOrder(input) {
      const order = await request<RazorpayOrder>("POST", "/orders", {
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      });
      return { orderId: order.id };
    },
    async fetchOrderPayments(orderId) {
      const result = await request<RazorpayCollection<RazorpayPaymentEntity>>(
        "GET",
        `/orders/${encodeURIComponent(orderId)}/payments`,
      );
      return (result.items ?? []).map((p): GatewayPayment => ({
        paymentId: p.id,
        status: p.status,
        amountMinor: p.amount,
        currency: p.currency,
      }));
    },
    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return signatureMatches(
        hmacSha256Hex(config.keySecret, `${orderId}|${paymentId}`),
        signature,
      );
    },
    verifyWebhookSignature(rawBody, signature) {
      return signatureMatches(hmacSha256Hex(config.webhookSecret, rawBody), signature);
    },
  };
}
