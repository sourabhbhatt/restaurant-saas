import { adminAuditQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Platform-wide audit log (all workspaces and platform actions). */
export const GET = route(
  { auth: "platform", query: adminAuditQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listAudit(actor, query),
  }),
);
