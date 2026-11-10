import type { SubscriptionJobResult } from "@ros/contracts/platform";
import { DomainError } from "@ros/domain/shared/errors";
import { paymentService } from "@/composition/payments";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";
import { isAuthorizedCron } from "@ros/application/modules/platform/cron-auth";

/**
 * Scheduled subscription sweep (trial reminders, trial/period/grace end
 * notices). Call with `Authorization: Bearer $CRON_SECRET`. Idempotent: safe
 * to run as often as you like (hourly is plenty).
 */
export const POST = route({ auth: "public", skipOriginCheck: true }, async ({ req, c }) => {
  if (!isAuthorizedCron(req.headers.get("authorization"), c.env.CRON_SECRET)) {
    throw new DomainError("UNAUTHENTICATED", "Invalid or missing job credentials");
  }
  // Growth analytics: unpaid checkouts forget their buyer's GA4 client id after 48 hours. Run
  // first and on its own, so a failing subscription sweep can never skip it (and vice versa).
  let analytics = { analyticsIdsCleared: 0 };
  try {
    analytics = await paymentService(c).forgetAbandonedAnalyticsIds();
  } catch (error) {
    c.logger.error("analytics_id_cleanup_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
  const result = await platformService(c).runSubscriptionSweep();
  const data: SubscriptionJobResult = { ...result, ...analytics };
  c.logger.info("subscription_sweep_completed", { ...data });
  return { data };
});
