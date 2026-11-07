import { z } from "zod";

import { tableService } from "@/composition/tables";
import { route } from "@ros/application/http/route";

const params = z.object({ branchId: z.uuid() });
const query = z.object({
  /** Comma-separated table ids; omitted = every table of the branch. */
  tableIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : null))
    .pipe(z.array(z.uuid()).max(200).nullable()),
});

/** Active QR codes (url + svg) for the printable sheet. `tables.manage` */
export const GET = route({ auth: "user", params, query }, async ({ actor, params, query, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await tableService(c).qrSheet(scope, query.tableIds) };
});
