import { describe, expect, it, vi } from "vitest";

import { hmacSha256Hex } from "../hmac";
import { createRazorpayGateway, RazorpayApiError } from "./razorpay";

const config = {
  keyId: "rzp_test_abc",
  keySecret: "key-secret-for-tests",
  webhookSecret: "webhook-secret-for-tests",
  baseUrl: "https://razorpay.test/v1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("razorpay gateway", () => {
  it("creates an order with HTTP Basic auth and the plan amount", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "order_123" }));
    const gw = createRazorpayGateway({ ...config, fetch: fetchMock as unknown as typeof fetch });
    const result = await gw.createOrder({
      amountMinor: 99900,
      currency: "INR",
      receipt: "receipt-1",
      notes: { planKey: "pro" },
    });
    expect(result).toEqual({ orderId: "order_123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://razorpay.test/v1/orders");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("rzp_test_abc:key-secret-for-tests").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 99900,
      currency: "INR",
      receipt: "receipt-1",
      notes: { planKey: "pro" },
    });
  });

  it("lists an order's payments", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        entity: "collection",
        items: [{ id: "pay_1", status: "captured", amount: 99900, currency: "INR" }],
      }),
    );
    const gw = createRazorpayGateway({ ...config, fetch: fetchMock as unknown as typeof fetch });
    expect(await gw.fetchOrderPayments("order_1")).toEqual([
      { paymentId: "pay_1", status: "captured", amountMinor: 99900, currency: "INR" },
    ]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://razorpay.test/v1/orders/order_1/payments",
    );
  });

  it("surfaces API errors without the secret", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { error: { code: "BAD_REQUEST_ERROR", description: "amount too small" } }),
    );
    const gw = createRazorpayGateway({ ...config, fetch: fetchMock as unknown as typeof fetch });
    const error = await gw
      .createOrder({ amountMinor: 1, currency: "INR", receipt: "r", notes: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RazorpayApiError);
    expect(String(error)).not.toContain(config.keySecret);
  });

  it("verifies the checkout and webhook signatures with the right secrets", () => {
    const gw = createRazorpayGateway(config);
    const good = hmacSha256Hex(config.keySecret, "order_1|pay_1");
    expect(
      gw.verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature: good }),
    ).toBe(true);
    expect(
      gw.verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_2", signature: good }),
    ).toBe(false);
    expect(
      gw.verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature: "abc" }),
    ).toBe(false);

    const body = '{"event":"order.paid"}';
    expect(gw.verifyWebhookSignature(body, hmacSha256Hex(config.webhookSecret, body))).toBe(true);
    expect(gw.verifyWebhookSignature(body, hmacSha256Hex(config.keySecret, body))).toBe(false);
  });
});
