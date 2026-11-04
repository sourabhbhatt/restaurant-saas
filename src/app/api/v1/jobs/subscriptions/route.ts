import { DomainError } from "@/domain/shared/errors";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";
import { isAuthorizedCron } from "@/server/modules/platform/cron-auth";

/**
 * Scheduled subscription sweep (trial reminders, trial/period/grace end
 * notices). Call with `Authorization: Bearer $CRON_SECRET`. Idempotent: safe
 * to run as often as you like (hourly is plenty).
 */
export const POST = route({ auth: "public", skipOriginCheck: true }, async ({ req, c }) => {
  if (!isAuthorizedCron(req.headers.get("authorization"), c.env.CRON_SECRET)) {
    throw new DomainError("UNAUTHENTICATED", "Invalid or missing job credentials");
  }
  const result = await platformService(c).runSubscriptionSweep();
  c.logger.info("subscription_sweep_completed", { ...result });
  return { data: result };
});
