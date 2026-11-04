import { z } from "zod";

import { updateTableSchema } from "@/contracts/tables";
import { tableService } from "@/server/composition/tables";
import { route } from "@/server/http/route";

const params = z.object({ tableId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const svc = tableService(c);
  const scope = await svc.scopeForTable(actor, params.tableId);
  return { data: await svc.get(scope, params.tableId) };
});

export const PATCH = route(
  { auth: "user", params, body: updateTableSchema },
  async ({ actor, params, body, meta, c }) => {
    const svc = tableService(c);
    const scope = await svc.scopeForTable(actor, params.tableId);
    return { data: await svc.update(scope, params.tableId, body, meta) };
  },
);

/** Soft delete; revokes the table's QR. */
export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const svc = tableService(c);
  const scope = await svc.scopeForTable(actor, params.tableId);
  await svc.remove(scope, params.tableId, meta);
  return { data: { id: params.tableId, deleted: true } };
});
