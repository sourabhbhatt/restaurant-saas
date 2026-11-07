import { paymentService } from "@/composition/payments";
import { route } from "@ros/application/http/route";

const MAX_BODY = 256 * 1024;

/**
 * Razorpay webhook (`order.paid`, `payment.captured`). Public and cross-origin
 * by nature: the HMAC over the raw body is the authentication, so the body is
 * read here untouched instead of through the wrapper's JSON parsing. Verified
 * deliveries always get 2xx, including ignored event types and replays.
 */
export const POST = route(
  { auth: "public", skipOriginCheck: true, allowInMaintenance: true },
  async ({ req, meta, c }) => {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY) return { status: 413, data: { received: false } };
    return {
      data: await paymentService(c).handleWebhook(
        {
          rawBody,
          signature: req.headers.get("x-razorpay-signature"),
          eventId: req.headers.get("x-razorpay-event-id"),
        },
        meta,
      ),
    };
  },
);
