import { z } from "zod";

import { forbidden } from "@ros/domain/shared/errors";
import { assertFeature } from "@ros/domain/subscriptions/entitlements";
import { eventStreamResponse } from "@ros/application/modules/staff-ops/http/event-stream";
import { route } from "@ros/application/http/route";

/**
 * Server-Sent Events for a branch (orders.view or kitchen.view). Events are
 * refetch hints only; clients keep polling, so a dropped stream loses nothing.
 */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ req, actor, params, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    const permission = (["orders.view", "kitchen.view"] as const).find((p) => scope.can(p));
    if (!permission) throw forbidden();
    scope.require(permission);
    // Orders-view staff keep their stream; only kitchen-only access is a KDS feature.
    if (permission === "kitchen.view") assertFeature(scope.entitlements, "kitchen_display");
    return eventStreamResponse({
      bus: c.realtime,
      channel: `branch:${scope.branchId}`,
      signal: req.signal,
      requestId: meta.requestId,
    });
  },
);
