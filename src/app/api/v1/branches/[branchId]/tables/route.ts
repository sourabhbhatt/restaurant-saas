import { z } from "zod";

import { createTableSchema } from "@/contracts/tables";
import { tableService } from "@/server/composition/tables";
import { route } from "@/server/http/route";

const params = z.object({ branchId: z.uuid() });

/** Tables with derived status (open session + live bill). `tables.view` */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await tableService(c).list(scope) };
});

export const POST = route(
  { auth: "user", params, body: createTableSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { status: 201, data: await tableService(c).create(scope, body, meta) };
  },
);
