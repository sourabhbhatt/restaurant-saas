/**
 * Payment gateway port: one prepaid order per billing period, paid through
 * the provider's hosted checkout. The adapter owns the provider's REST API
 * and both signature schemes; the payments module never sees a secret.
 * Amounts are minor units (paise for INR).
 */
export interface PaymentGateway {
  readonly name: string;
  createOrder(input: {
    amountMinor: number;
    currency: string;
    /** Our payment order id, echoed back by the provider (max 40 chars). */
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ orderId: string }>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  /** The checkout callback signature: HMAC-SHA256(`${orderId}|${paymentId}`, key secret). */
  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
  /** The webhook signature: HMAC-SHA256(raw body, webhook secret). */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export interface GatewayPayment {
  paymentId: string;
  status: "captured" | "authorized" | "failed" | (string & {});
  amountMinor: number;
  currency: string;
}
