import { z } from "zod";

import { bulkCreateTablesSchema } from "@ros/contracts/tables";
import { tableService } from "@/composition/tables";
import { route } from "@ros/application/http/route";

const params = z.object({ branchId: z.uuid() });

/** Bulk create `{ prefix, from, to, capacity, section? }` → e.g. T1..T10. */
export const POST = route(
  { auth: "user", params, body: bulkCreateTablesSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { status: 201, data: await tableService(c).bulkCreate(scope, body, meta) };
  },
);
